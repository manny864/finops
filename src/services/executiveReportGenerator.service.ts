/**
 * executiveReportGenerator.service.ts — Motor de Agregación y Generación de Reportes Ejecutivos FinOps.
 *
 * Funcionalidades:
 *   1. Agregador Holístico de Telemetría Multi-Módulo (FOCUS 1.0, Desperdicio, Rightsizing, HA, Tags, Commitments, Carbon).
 *   2. Generador de Análisis Ejecutivo C-Level mediante LLM (Azure OpenAI / BYOK / Gemini) con System Prompt de 6 secciones obligatorias.
 *   3. Compilador de Documentos HTML con soporte estricto de Paged Media A4 (@page, márgenes de 15mm y saltos de página inteligentes).
 *   4. Despachador de Correos Transaccionales Responsivos con PDF adjunto.
 *
 * Regla Cero: Precisión matemática estricta con Decimal.js.
 * DLP (IA-5): Redactado automático de datos antes del envío a proveedores externos.
 */
import Decimal from 'decimal.js';
import pool, { insertPlatformAiUsage } from '@/modules/storage/db';
import { RowDataPacket } from 'mysql2';
import { errorMessage } from '@/lib/apiErrors';
import { jsPDF } from 'jspdf';
import { generateText } from 'ai';
import { AIProviderFactory, aiQueue, withExponentialBackoff } from '@/modules/core/aiProvider';
import { redactForTenant } from '@/modules/core/aiProvider';
import { sendEmailStrict, type EmailAttachment } from '@/lib/emailHelper';
import type {
    ExecutiveReportFullData,
    ExecutiveReportScope,
    HistoricalMonthCost,
    InefficiencyCategoryBreakdown,
    ResourceFamilyBreakdown,
    ResourceFamilySpend,
    TelemetryCollectorStatus,
} from '@/types/executiveReport.types';
import type { FinOpsCategoryDetail } from '@/lib/categoryConsumptionTypes';
import { getRealCategoryOverview } from '@/services/categoryConsumptionService';
import { evaluateHALive } from '@/services/haService';
import { isMockTenant } from '@/lib/mockData';

export const EXECUTIVE_HISTORY_MONTHS = 6;

export const HARD_WASTE_CONFIG: Record<string, { type: string; unitCost: number; issueName: string }> = {
    unattachedDisks: { type: 'Discos Desasociados', unitCost: 15.0, issueName: 'Discos huérfanos sin VM' },
    unusedIps: { type: 'IPs Públicas Huérfanas', unitCost: 3.5, issueName: 'Direcciones IP sin asignar' },
    staleSnapshots: { type: 'Snapshots Antiguos', unitCost: 5.0, issueName: 'Snapshots con más de 90 días' },
    emptyAppServicePlans: { type: 'App Service Plans Vacíos', unitCost: 45.0, issueName: 'Planes ASP sin aplicaciones' },
    elasticPools: { type: 'SQL Elastic Pools Vacíos', unitCost: 250.0, issueName: 'Pools SQL sin bases de datos' },
    orphanBackups: { type: 'Backups Retenidos sin Uso', unitCost: 20.0, issueName: 'Puntos de restauración huérfanos' },
    expiredTtlResources: { type: 'Recursos Vencidos por TTL', unitCost: 30.0, issueName: 'Recursos activos fuera de ventana TTL' },
};

/**
 * Agregador Holístico de Telemetría para Reporte Ejecutivo.
 */
type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Corre un colector sin que su fallo tumbe el barrido completo.
 *
 * El motivo de que esto exista y no un `Promise.allSettled` pelado: el reporte
 * necesita DISTINGUIR "el tenant no tiene desperdicio" de "no pude leer el
 * desperdicio". Un catch que devuelve [] funde los dos casos y el LLM termina
 * escribiendo que el tenant esta optimizado cuando en realidad la consulta
 * fallo. Por eso cada colector reporta su estado y ese estado viaja al prompt.
 */
async function collect<T>(name: string, fn: () => Promise<T>): Promise<Settled<T> & { collector: string }> {
    try {
        return { collector: name, ok: true, value: await fn() };
    } catch (err) {
        const error = errorMessage(err) || String(err);
        console.error(`[executiveReport] colector "${name}" fallo:`, error);
        return { collector: name, ok: false, error };
    }
}

const FAMILY_KEYS: Record<string, keyof Omit<ResourceFamilyBreakdown, 'others'>> = {
    Compute: 'compute',
    Databases: 'databases',
    'AI and Machine Learning': 'aiAndMachineLearning',
    Networking: 'networking',
    Storage: 'storage',
};

function toFamilySpend(detail: FinOpsCategoryDetail): ResourceFamilySpend {
    return {
        category: detail.category,
        monthlyCostUSD: round2(detail.totalCost),
        percentageOfTotal: round2(detail.percentage),
        momVariationPercent: round2(detail.momVariation),
        projectedMonthEndUSD: round2(detail.projectedCost),
        // Se corta en 5: el prompt necesita los que mueven la aguja, no el
        // inventario completo, y cada servicio extra son tokens de entrada.
        topServices: (detail.services || []).slice(0, 5).map((svc) => ({
            name: svc.name,
            costUSD: round2(svc.cost),
            resourceCount: svc.count,
        })),
    };
}

function round2(n: number): number {
    return new Decimal(Number.isFinite(n) ? n : 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Agregador Holístico de Telemetría para Reporte Ejecutivo.
 *
 * Los colectores corren CONCURRENTES: antes el barrido era secuencial y, peor,
 * las secciones de desperdicio, HA, anomalias, rightsizing y presupuestos eran
 * literales hardcodeados — el reporte de un tenant real presentaba numeros
 * inventados como si fueran su telemetria viva. Ahora cada seccion sale de su
 * fuente o queda vacia, y `collectorStatus` dice cual fue el caso.
 */
export async function aggregateExecutiveTelemetry(
    tenantId: string,
    scope: ExecutiveReportScope = 'TENANT_ALL',
    scopeId?: string
): Promise<ExecutiveReportFullData> {
    const reportId = `exec-rep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    if (isMockTenant(tenantId)) {
        return getMockExecutiveReportFullData(tenantId, scope, scopeId);
    }

    const [
        identity,
        history,
        mtd,
        families,
        ha,
        waste,
        anomalyRows,
        budgetRows,
    ] = await Promise.all([
        collect('tenantIdentity', async () => {
            // `Tenants` no tiene columna `name` ni `currency`: el nombre es
            // `company_name` y la moneda vive en CostSnapshots.
            const [rows] = await pool.query<RowDataPacket[]>(
                'SELECT company_name, tier FROM Tenants WHERE tenant_id = ? LIMIT 1',
                [tenantId]
            );
            return { orgName: rows[0]?.company_name || 'Organización', tier: rows[0]?.tier || null };
        }),

        collect('historicalTrends', async () => {
            // CostSnapshots no tiene `snapshot_date` ni `billed_cost`. Se usa el
            // mismo COALESCE que el resto del repo (invoicing, account-status):
            // las filas FOCUS traen ChargePeriodStart/BilledCost y las legacy
            // date/cost_usd.
            const [rows] = await pool.query<RowDataPacket[]>(
                `SELECT DATE_FORMAT(COALESCE(ChargePeriodStart, date), '%Y-%m') AS monthKey,
                        SUM(COALESCE(BilledCost, cost_usd, 0)) AS totalBilledCost
                 FROM CostSnapshots
                 WHERE tenant_id = ?
                   AND COALESCE(ChargePeriodStart, date) >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
                 GROUP BY DATE_FORMAT(COALESCE(ChargePeriodStart, date), '%Y-%m')
                 ORDER BY monthKey ASC`,
                [tenantId, EXECUTIVE_HISTORY_MONTHS]
            );

            let prevCost: Decimal | null = null;
            return (rows || []).map((row): HistoricalMonthCost => {
                const cost = new Decimal(row.totalBilledCost || 0);
                let comparisonVsPreviousMonthPercent: number | null = null;
                let trend: 'BULLISH' | 'BEARISH' | 'STABLE' = 'STABLE';
                if (prevCost && prevCost.greaterThan(0)) {
                    const delta = cost.minus(prevCost).dividedBy(prevCost).times(100);
                    comparisonVsPreviousMonthPercent = delta.toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber();
                    if (comparisonVsPreviousMonthPercent > 2) trend = 'BULLISH';
                    else if (comparisonVsPreviousMonthPercent < -2) trend = 'BEARISH';
                }
                prevCost = cost;
                return {
                    monthKey: row.monthKey,
                    costUSD: cost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
                    comparisonVsPreviousMonthPercent,
                    trend,
                };
            });
        }),

        collect('mtdSpend', async () => {
            const [rows] = await pool.query<RowDataPacket[]>(
                `SELECT SUM(COALESCE(BilledCost, cost_usd, 0)) AS mtdTotal
                 FROM CostSnapshots
                 WHERE tenant_id = ?
                   AND COALESCE(ChargePeriodStart, date) >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
                [tenantId]
            );
            return new Decimal(rows[0]?.mtdTotal || 0);
        }),

        // Un solo colector cubre cuatro familias (Bases de Datos, IA, Redes y
        // Almacenamiento) mas Computo: salen del join CostCategorySnapshots x
        // OpenDataServices que ya mantiene categoryConsumptionService, sin
        // pegarle de nuevo a Azure.
        collect('resourceFamilies', () => getRealCategoryOverview(tenantId, 30)),

        collect('haRisks', () => evaluateHALive(tenantId)),

        collect('hardWaste', async () => {
            const [rows] = await pool.query<RowDataPacket[]>(
                `SELECT reason, COUNT(*) AS affected, SUM(COALESCE(estimated_waste_usd, 0)) AS wasteUsd
                 FROM ZombieResources
                 WHERE tenant_id = ? AND status = 'active'
                 GROUP BY reason
                 ORDER BY wasteUsd DESC`,
                [tenantId]
            );
            return rows || [];
        }),

        collect('anomalies', async () => {
            const [rows] = await pool.query<RowDataPacket[]>(
                `SELECT detected_date, service_name, actual_cost_usd, expected_cost_usd,
                        deviation_percentage, severity
                 FROM Anomalies
                 WHERE tenant_id = ?
                 ORDER BY detected_date DESC
                 LIMIT 20`,
                [tenantId]
            );
            return rows || [];
        }),

        collect('budgets', async () => {
            const [rows] = await pool.query<RowDataPacket[]>(
                `SELECT name, amount_usd, actual_spend_usd
                 FROM Budgets WHERE tenant_id = ? AND active = 1`,
                [tenantId]
            );
            return rows || [];
        }),
    ]);

    const collectorStatus: TelemetryCollectorStatus[] = [
        identity, history, mtd, families, ha, waste, anomalyRows, budgetRows,
    ].map((r) => (r.ok ? { collector: r.collector, ok: true } : { collector: r.collector, ok: false, error: r.error }));

    // ── Costos y proyeccion ──────────────────────────────────────────────
    const historicalTrends: HistoricalMonthCost[] = history.ok ? history.value : [];
    const mtdSpend = mtd.ok ? mtd.value : new Decimal(0);
    const todayDay = Math.max(1, new Date().getDate());
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const projectedMonthEnd = mtdSpend.dividedBy(todayDay).times(daysInMonth).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    const lastMonthHistorical = historicalTrends.length > 1 ? historicalTrends[historicalTrends.length - 2]?.costUSD : null;
    const momVariation = lastMonthHistorical && lastMonthHistorical > 0
        ? projectedMonthEnd.minus(lastMonthHistorical).dividedBy(lastMonthHistorical).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber()
        : 0;

    // ── Familias de recursos ─────────────────────────────────────────────
    const resourceFamilies: ResourceFamilyBreakdown = {
        compute: null, databases: null, aiAndMachineLearning: null,
        networking: null, storage: null, others: [],
    };
    if (families.ok) {
        for (const detail of families.value.categories || []) {
            const key = FAMILY_KEYS[detail.category];
            if (key) resourceFamilies[key] = toFamilySpend(detail);
            else resourceFamilies.others.push(toFamilySpend(detail));
        }
    }

    // ── Desperdicio ──────────────────────────────────────────────────────
    const wasteRows = waste.ok ? waste.value : [];
    const monthlyWasteTotal = wasteRows.reduce((acc, r) => acc + Number(r.wasteUsd || 0), 0);
    const inefficiencyDistribution: InefficiencyCategoryBreakdown[] = wasteRows.map((r) => ({
        categoryName: String(r.reason || 'Sin clasificar'),
        affectedResourcesCount: Number(r.affected || 0),
        monthlyWasteUSD: round2(Number(r.wasteUsd || 0)),
        percentageOfTotalWaste: monthlyWasteTotal > 0
            ? round2((Number(r.wasteUsd || 0) / monthlyWasteTotal) * 100)
            : 0,
    }));

    // ── HA ───────────────────────────────────────────────────────────────
    const haItems = ha.ok ? ha.value.items : [];
    const haRisks = haItems.slice(0, 25).map((item) => ({
        resourceName: item.resourceName,
        resourceType: item.resourceType,
        severity: item.severity,
        issueType: item.issueType,
        estimatedRisk: item.estimatedRisk,
    }));
    const criticalHighHaRisksCount = haItems.filter((i) => i.severity === 'critical' || i.severity === 'high').length;

    // ── Anomalias ────────────────────────────────────────────────────────
    const anomalies = (anomalyRows.ok ? anomalyRows.value : []).map((row) => ({
        date: row.detected_date instanceof Date
            ? row.detected_date.toISOString().slice(0, 10)
            : String(row.detected_date || '').slice(0, 10),
        resource: String(row.service_name || 'Servicio no identificado'),
        impactUSD: round2(Number(row.actual_cost_usd || 0) - Number(row.expected_cost_usd || 0)),
        severity: `${row.severity || 'unknown'} (${round2(Number(row.deviation_percentage || 0))}% de desvío)`,
    }));

    // ── Presupuestos ─────────────────────────────────────────────────────
    const budgetsExecution = (budgetRows.ok ? budgetRows.value : []).map((row) => {
        const amountUSD = round2(Number(row.amount_usd || 0));
        const currentSpendUSD = round2(Number(row.actual_spend_usd || 0));
        const burnPercent = amountUSD > 0 ? round2((currentSpendUSD / amountUSD) * 100) : 0;
        return { name: String(row.name || ''), amountUSD, currentSpendUSD, burnPercent, isExceeded: currentSpendUSD > amountUSD };
    });
    const budgetBurnPercent = budgetsExecution.length > 0
        ? round2(budgetsExecution.reduce((acc, b) => acc + b.burnPercent, 0) / budgetsExecution.length)
        : 0;

    // Rightsizing, tags, compromisos y CO2 todavia no tienen colector: quedan
    // en vacio/0 a proposito. Antes eran literales hardcodeados que el reporte
    // presentaba como telemetria del tenant.
    const rightsizingRecommendations: ExecutiveReportFullData["rightsizingRecommendations"] = [];

    return {
        reportId,
        generatedAtIso: new Date().toISOString(),
        tenantId,
        organizationName: identity.ok ? identity.value.orgName : 'Organización',
        scope,
        scopeDisplayName: scope === 'TENANT_ALL' ? 'Tenant completo (todas las suscripciones)' : (scopeId || 'Suscripción seleccionada'),
        kpiMetrics: {
            mtdSpendUSD: mtdSpend.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
            momVariationPercent: momVariation,
            projectedMonthEndUSD: projectedMonthEnd.toNumber(),
            monthlySavingsIdentifiedUSD: round2(monthlyWasteTotal),
            annualizedSavingsUSD: round2(monthlyWasteTotal * 12),
            criticalHighHaRisksCount,
            co2ImpactKg: 0,
            taggingCoveragePercent: 0,
            commitmentsCoveragePercent: 0,
            rightsizingCandidatesCount: rightsizingRecommendations.length,
            rightsizingSavingsUSD: 0,
            activeAnomaliesCount: anomalies.length,
            budgetBurnPercent,
        },
        historicalTrends,
        inefficiencyDistribution,
        haRisks,
        anomalies,
        rightsizingRecommendations,
        budgetsExecution,
        resourceFamilies,
        collectorStatus,
    };
}

/**
 * Genera datos mock para tenant de demostración.
 */
function getMockExecutiveReportFullData(tenantId: string, scope: ExecutiveReportScope, scopeId?: string): ExecutiveReportFullData {
    return {
        reportId: `demo-rep-${Date.now()}`,
        generatedAtIso: new Date().toISOString(),
        tenantId,
        organizationName: 'CSCS Cloud Solutions (Demo Tenant)',
        scope,
        scopeDisplayName: scope === 'TENANT_ALL' ? 'Tenant completo (todas las suscripciones)' : (scopeId || 'CSCS-LandingZone-Prod'),
        kpiMetrics: {
            mtdSpendUSD: 675.84,
            momVariationPercent: 15.2,
            projectedMonthEndUSD: 936.37,
            monthlySavingsIdentifiedUSD: 9930.00,
            annualizedSavingsUSD: 119160.00,
            criticalHighHaRisksCount: 45,
            co2ImpactKg: 206.25,
            taggingCoveragePercent: 83.0,
            commitmentsCoveragePercent: 45.0,
            rightsizingCandidatesCount: 6,
            rightsizingSavingsUSD: 1113.50,
            activeAnomaliesCount: 1,
            budgetBurnPercent: 68.5,
        },
        historicalTrends: [
            { monthKey: '2026-03', costUSD: 590420.10, comparisonVsPreviousMonthPercent: null, trend: 'STABLE' },
            { monthKey: '2026-04', costUSD: 615200.00, comparisonVsPreviousMonthPercent: 4.2, trend: 'BULLISH' },
            { monthKey: '2026-05', costUSD: 630150.50, comparisonVsPreviousMonthPercent: 2.4, trend: 'BULLISH' },
            { monthKey: '2026-06', costUSD: 610900.00, comparisonVsPreviousMonthPercent: -3.1, trend: 'BEARISH' },
            { monthKey: '2026-07', costUSD: 641425.54, comparisonVsPreviousMonthPercent: 5.0, trend: 'BULLISH' },
            { monthKey: '2026-08', costUSD: 675840.00, comparisonVsPreviousMonthPercent: 5.4, trend: 'BULLISH' },
        ],
        inefficiencyDistribution: [
            { categoryName: 'Discos Desasociados', affectedResourcesCount: 14, monthlyWasteUSD: 3120.00, percentageOfTotalWaste: 31.4 },
            { categoryName: 'IPs Públicas Huérfanas', affectedResourcesCount: 22, monthlyWasteUSD: 1840.00, percentageOfTotalWaste: 18.5 },
            { categoryName: 'Snapshots >90d', affectedResourcesCount: 38, monthlyWasteUSD: 2450.00, percentageOfTotalWaste: 24.7 },
            { categoryName: 'App Service Plans Vacíos', affectedResourcesCount: 4, monthlyWasteUSD: 1520.00, percentageOfTotalWaste: 15.3 },
            { categoryName: 'Recursos Vencidos por TTL', affectedResourcesCount: 5, monthlyWasteUSD: 1000.00, percentageOfTotalWaste: 10.1 },
        ],
        haRisks: [
            { resourceName: 'vm-db-core-master', resourceType: 'Microsoft.Compute/virtualMachines', severity: 'critical', issueType: 'Sin réplica zonal ni failover automático', estimatedRisk: 'RTO > 4 horas ante indisponibilidad zonal' },
            { resourceName: 'vnet-gw-eastus2', resourceType: 'Microsoft.Network/virtualNetworkGateways', severity: 'high', issueType: 'Gateway SKU Básico sin soporte de Zonas', estimatedRisk: 'Degradación de túnel VPN site-to-site' },
            { resourceName: 'app-service-portal', resourceType: 'Microsoft.Web/serverfarms', severity: 'medium', issueType: 'Instancia única sin autoscaling zonal', estimatedRisk: 'Saturación en horas pico de facturación' },
        ],
        anomalies: [
            { date: '2026-08-18', resource: 'Azure Cognitive Search (Ingestión de Vectores)', impactUSD: 1420.00, severity: 'Crítica (+350% vs línea base)' },
        ],
        rightsizingRecommendations: [
            { resourceName: 'vm-app-frontend-01', currentSku: 'Standard_D8s_v5', recommendedSku: 'Standard_D4s_v5', monthlySavingsUSD: 240.00 },
            { resourceName: 'vm-batch-processor-02', currentSku: 'Standard_E8s_v5', recommendedSku: 'Standard_D4s_v5', monthlySavingsUSD: 380.50 },
            { resourceName: 'sqldb-analytics-lake', currentSku: 'BusinessCritical_8vCore', recommendedSku: 'GeneralPurpose_8vCore', monthlySavingsUSD: 493.00 },
        ],
        budgetsExecution: [
            { name: 'Presupuesto Infraestructura Producción', amountUSD: 500000.00, currentSpendUSD: 342500.00, burnPercent: 68.5, isExceeded: false },
            { name: 'Presupuesto Innovación e IA Generativa', amountUSD: 50000.00, currentSpendUSD: 48500.00, burnPercent: 97.0, isExceeded: false },
        ],
        // El demo trae las cinco familias para que la seccion 2 del reporte
        // (barrido 360) se pueda mostrar; los colectores figuran todos en OK
        // porque el dataset es sintetico y completo por construccion.
        resourceFamilies: {
            compute: {
                category: 'Compute', monthlyCostUSD: 289450.20, percentageOfTotal: 42.1,
                momVariationPercent: 6.4, projectedMonthEndUSD: 301200.00,
                topServices: [
                    { name: 'Virtual Machines', costUSD: 198300.00, resourceCount: 142 },
                    { name: 'Azure Kubernetes Service', costUSD: 61150.20, resourceCount: 9 },
                    { name: 'App Service Plans', costUSD: 30000.00, resourceCount: 24 },
                ],
            },
            databases: {
                category: 'Databases', monthlyCostUSD: 121880.40, percentageOfTotal: 17.7,
                momVariationPercent: 2.1, projectedMonthEndUSD: 124500.00,
                topServices: [
                    { name: 'Azure SQL Database', costUSD: 68400.00, resourceCount: 31 },
                    { name: 'PostgreSQL Flexible Server', costUSD: 28980.40, resourceCount: 12 },
                    { name: 'Cosmos DB', costUSD: 24500.00, resourceCount: 6 },
                ],
            },
            aiAndMachineLearning: {
                category: 'AI and Machine Learning', monthlyCostUSD: 96320.00, percentageOfTotal: 14.0,
                momVariationPercent: 38.7, projectedMonthEndUSD: 110400.00,
                topServices: [
                    { name: 'Azure OpenAI', costUSD: 71200.00, resourceCount: 4 },
                    { name: 'AI Search', costUSD: 15120.00, resourceCount: 3 },
                    { name: 'Azure Machine Learning', costUSD: 10000.00, resourceCount: 2 },
                ],
            },
            networking: {
                category: 'Networking', monthlyCostUSD: 58940.10, percentageOfTotal: 8.6,
                momVariationPercent: -1.8, projectedMonthEndUSD: 57800.00,
                topServices: [
                    { name: 'ExpressRoute', costUSD: 26280.00, resourceCount: 2 },
                    { name: 'VPN Gateway', costUSD: 16800.00, resourceCount: 5 },
                    { name: 'NAT Gateway', costUSD: 9860.10, resourceCount: 7 },
                ],
            },
            storage: {
                category: 'Storage', monthlyCostUSD: 44210.75, percentageOfTotal: 6.4,
                momVariationPercent: 0.9, projectedMonthEndUSD: 44800.00,
                topServices: [
                    { name: 'Blob Storage (Hot)', costUSD: 24110.75, resourceCount: 38 },
                    { name: 'Managed Disks', costUSD: 14300.00, resourceCount: 210 },
                    { name: 'Blob Storage (Archive)', costUSD: 5800.00, resourceCount: 12 },
                ],
            },
            others: [],
        },
        collectorStatus: [
            { collector: 'tenantIdentity', ok: true },
            { collector: 'historicalTrends', ok: true },
            { collector: 'mtdSpend', ok: true },
            { collector: 'resourceFamilies', ok: true },
            { collector: 'haRisks', ok: true },
            { collector: 'hardWaste', ok: true },
            { collector: 'anomalies', ok: true },
            { collector: 'budgets', ok: true },
        ],
    };
}

/**
 * System Prompt Maestro para la generación del Reporte Ejecutivo C-Level.
 */
export const EXECUTIVE_REPORT_SYSTEM_PROMPT = `Eres el Arquitecto Principal de Azure FinOps y Asesor Estratégico Cloud (FinOps Copilot) de la plataforma SaaS de CSCloudSolutions.
Tu objetivo es analizar el JSON del tenant y redactar un Reporte Ejecutivo Estratégico C-Level (dirigido a CFO, CTO, CEO y Líderes de Infraestructura) en Markdown estructurado con 7 secciones obligatorias:

## 1. Resumen Ejecutivo y Diagnóstico Financiero C-Level
* Tabla de KPIs Financieros: Métrica Clave | Período Actual (USD) | Período Anterior (USD) | Variación MoM (%) | Proyección Cierre Mes (USD) | Meta / Target
* Diagnóstico de Situación: Síntesis ejecutiva (máximo 3 párrafos) explicando si el comportamiento del gasto es saludable, alcista o crítico, justificando las causas del desvío mensual frente al promedio histórico.

## 2. Barrido 360° por Familias de Recursos
* Usa "resourceFamilies" para desglosar Cómputo, Bases de Datos, IA & Inferencia, Redes y Almacenamiento: costo mensual, % del total, variación MoM, proyección de cierre y los servicios que más pesan dentro de cada familia.
* Una familia en "null" NO es una familia en cero: significa que el tenant no tiene gasto registrado ahí o que el dato no se pudo leer. Declará "Dato no disponible en este tenant" y no la incluyas en las sumas.
* Señalá qué familia explica el desvío del mes y cuál crece más rápido en términos relativos.

## 3. Economía Unitaria y Eficiencia de Asignación (Showback / Chargeback)
* Métricas Unitarias: Costo por usuario activo, transacción o unidad de negocio. Si falta el dato, declarar explícitamente: "Dato no disponible en este tenant".
* Higiene de Asignación: Porcentaje de gasto etiquetado vs. no asignado (Tagging Coverage) y su impacto financiero.

## 4. Matriz de Ineficiencias y Fuga de Capital (Hard Waste & Rightsizing)
* Desperdicio Inmediato: Desglose del costo mensual de discos huérfanos, IPs sin uso, backups retenidos y recursos vencidos por TTL.
* Optimización de Cómputo: Oportunidades de downsizing en máquinas virtuales y bases de datos con CPU/memoria < 10%.
* Cálculo de Ahorro Recuperable: Suma del ahorro mensual inmediato ($USD/mes) y anualizado ($ USD/año).

## 5. Optimización de Tarifas y Cobertura de Compromisos (Rate Optimization)
* Cobertura de Reservas y Savings Plans: Porcentaje cubierto vs. exposición a tarifa bajo demanda (Pay-As-You-Go).
* Beneficio Híbrido de Azure (AHB): Estado de adopción de licencias Windows Server y SQL Server.

## 6. Riesgos Operacionales, Alta Disponibilidad y Gobernanza
* Resiliencia vs. Costo: Evaluación de cargas críticas en single-host o sin redundancia zonal/geográfica, evaluando el riesgo de interrupción de SLA vs. el costo de remediación.
* Anomalías y Presupuestos: Estado de alertas de gasto imprevisto y porcentaje de consumo presupuestario.
* Sostenibilidad: Estimación de huella de carbono (CO2 en kg) e impacto de optimización.

## 7. Hoja de Ruta y Plan de Acción Priorizado (30 - 60 - 90 Días)
* Matriz de Decisiones Estratégicas: Fase / Plazo | Acción Recomendada | Impacto Estimado (USD/mes) | Nivel de Esfuerzo | Dueño Sugerido | ROI Clave
  - Inmediato (0-30d): Purgar desperdicio zombi sin riesgo.
  - Medio Plazo (30-60d): Rightsizing y políticas TTL.
  - Estratégico (60-90d): Commitments RIs/SPs y arquitectura HA.

Reglas estrictas:
1. Cero Alucinación: Basa cada afirmación en números concretos del JSON. Si falta algún dato, declara "Dato no disponible en este tenant".
1.b. Colectores caídos: el JSON trae "collectorStatus". Si un colector figura con ok:false, su sección NO tiene datos — está rota. NUNCA la reportes como cero, "sin hallazgos" ni "optimizado": decí explícitamente que la lectura de esa fuente falló y que el dato queda pendiente de verificación. Un cero real y una consulta fallida son cosas distintas y confundirlas hace que el reporte mienta.
2. Moneda y Formato: Todo en USD con formato estándar ($X,XXX.XX USD).
3. Tono: Ejecutivo, analítico y orientado a la toma de decisiones.`;

/**
 * Idioma de redaccion del reporte.
 *
 * El prompt terminaba en "Redacta en Español formal" y `locale` —que ya viaja
 * desde el frontend, se guarda en la fila del job y llega hasta
 * runRealJobProcess— nunca llegaba al modelo. Resultado: un usuario con la UI
 * en ingles pedia el reporte y recibia un PDF entero en castellano.
 */
const REPORT_LANGUAGES: Record<string, string> = {
    es: 'Spanish (español)',
    en: 'English',
    'pt-BR': 'Brazilian Portuguese (português do Brasil)',
};

function buildLanguageDirective(locale: string): string {
    const languageName = REPORT_LANGUAGES[locale] ?? REPORT_LANGUAGES.es;
    return `\n\nIDIOMA DE SALIDA (prioritario sobre cualquier otra instruccion de estilo): Generate the entire executive report strictly in the requested language: ${languageName}. All headings, diagnostic narratives, tables and tactical action plans must be written in this language. Do not mix languages.`;
}

/**
 * Invoca el LLM para generar la síntesis ejecutiva Markdown.
 */
export async function generateExecutiveReportAiMarkdown(
    data: ExecutiveReportFullData,
    userInstructions?: string,
    locale: string = 'es'
): Promise<string> {
    const tenantId = data.tenantId;
    const redactedMetrics = await redactForTenant(tenantId, data);
    const dataString = JSON.stringify(redactedMetrics, null, 2);

    const { model, modelName, config } = await AIProviderFactory.getGeminiModel(tenantId);

    const { text, usage } = await aiQueue.add(() =>
        withExponentialBackoff(() =>
            generateText({
                model: model as any,
                system: EXECUTIVE_REPORT_SYSTEM_PROMPT
                    + buildLanguageDirective(locale)
                    + (userInstructions ? `\n\nINSTRUCCIONES ADICIONALES DEL USUARIO:\n${userInstructions}` : ''),
                // Analisis numerico: la temperatura por defecto de cada proveedor
                // deja margen para que el modelo "redondee" cifras del JSON.
                temperature: 0.2,
                prompt: `Analiza la telemetría viva de este tenant y genera el Reporte Ejecutivo FinOps completo:\n\n${dataString}`,
            })
        )
    );

    insertPlatformAiUsage({
        tenantId,
        source: config.source,
        provider: config.provider,
        modelName,
        feature: 'executive-report',
        inputTokens: usage.inputTokens || 0,
        outputTokens: usage.outputTokens || 0,
    });

    return text;
}

/**
 * Construye el documento HTML con estilos de impresión Paged Media A4.
 */
import {
    parseExecutiveMarkdownToHtml,
    compileKpiGridHtml,
} from '@/lib/reports/reportHtmlTransformer';
import {
    renderPdfReportHtml,
} from '@/lib/reports/templates/pdfReportTemplate';
import {
    renderEmailReportHtml,
} from '@/lib/reports/templates/emailReportTemplate';

/**
 * Compilador de Documento HTML Paged Media para Descarga / Exportación PDF.
 */
export function buildExecutiveReportHtmlDocument(
    data: ExecutiveReportFullData,
    aiMarkdown: string
): string {
    const parsedContentHtml = parseExecutiveMarkdownToHtml(aiMarkdown || data.aiMarkdown || '');
    const kpiGridHtml = compileKpiGridHtml(data.kpiMetrics);

    return renderPdfReportHtml({
        organizationName: data.organizationName || 'Organización',
        scopeDisplayName: data.scopeDisplayName || 'Tenant completo',
        generationDate: new Date(data.generatedAtIso || Date.now()).toLocaleString('es-AR'),
        kpiGridHtml,
        parsedContentHtml,
    });
}

/**
 * Despachador de Correo Electrónico con Reporte Adjunto.
 */
export async function dispatchExecutiveReportEmail(params: {
    tenantName: string;
    recipientEmail: string;
    reportMarkdown: string;
    pdfBufferBase64: string;
    fileBaseName: string;
    scopeDisplayName?: string;
    introMessage?: string;
    kpiSnapshot?: any;
}): Promise<void> {
    const {
        tenantName,
        recipientEmail,
        reportMarkdown,
        pdfBufferBase64,
        fileBaseName,
        scopeDisplayName = 'Tenant completo',
        introMessage,
        kpiSnapshot,
    } = params;

    const parsedContentHtml = parseExecutiveMarkdownToHtml(reportMarkdown);

    const mtdSpend = kpiSnapshot?.mtdSpendUSD ?? 0;
    const projected = kpiSnapshot?.projectedMonthEndUSD ?? 0;
    const savings = kpiSnapshot?.monthlySavingsIdentifiedUSD ?? 0;
    const haRisks = kpiSnapshot?.criticalHighHaRisksCount ?? 0;

    const emailSubject = `Reporte Ejecutivo FinOps · ${tenantName}`;
    const emailHtml = renderEmailReportHtml({
        tenantName,
        scopeDisplayName,
        generationDate: new Date().toLocaleString('es-AR'),
        introMessage,
        kpiHighlights: [
            { label: 'Gasto MTD', value: `$${mtdSpend.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, color: '#0078D4' },
            { label: 'Proyección Mes', value: `$${projected.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, color: '#2563EB' },
            { label: 'Ahorro Remediable', value: `$${savings.toLocaleString('en-US', { minimumFractionDigits: 2 })}/m`, color: '#0284C7' },
            { label: 'Riesgos HA', value: `${haRisks}`, subtext: 'Críticos/Altos', color: '#0078D4' },
        ],
        parsedContentHtml,
        reportUrl: (process.env.NEXT_PUBLIC_APP_URL || 'https://finops.cscloudsolutions.com.ar').replace(/\/+$/, '') + '/es/admin/reports?tab=executive',
    });

    const attachments: EmailAttachment[] = [
        {
            name: `${fileBaseName}.pdf`,
            contentType: 'application/pdf',
            contentBase64: pdfBufferBase64,
        },
    ];

    await sendEmailStrict(emailSubject, emailHtml, recipientEmail, attachments);
}

export const aggregateExecutiveReportData = aggregateExecutiveTelemetry;
export const generateExecutiveAssessment = generateExecutiveReportAiMarkdown;


