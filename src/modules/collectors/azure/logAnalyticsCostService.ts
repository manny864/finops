/**
 * Log Analytics Cost Service — control de costos de Azure Monitor Log Analytics
 * Workspaces (Microsoft.OperationalInsights/workspaces).
 *
 * RBAC mínimo requerido (Service Principal del tenant, SOLO LECTURA):
 *   - Reader (Resource Graph) para inventariar workspaces, su SKU/pricing tier,
 *     retención (retentionInDays) y tope diario de ingesta (workspaceCapping).
 *   - Cost Management Reader para el costo MonthToDate por workspace.
 * No requiere ningún rol de escritura. Feature de tier Business+ (ver route.ts).
 *
 * Palancas de optimización cubiertas (las 3 del backlog FinOps):
 *   1. Ingesta masiva innecesaria → detectar workspaces sin tope diario
 *      (dailyQuotaGb) y recomendar filtrar en origen + fijar un daily cap.
 *   2. Retención excesiva → recomendar reducir retentionInDays cuando supera el
 *      umbral (los primeros 31 días de retención interactiva son gratis en
 *      Azure; más allá se paga por GB-mes).
 *   3. Commitment Tiers → cuando un workspace en Pay-As-You-Go (PerGB2018)
 *      ingiere suficiente volumen diario, un Commitment Tier reduce el precio
 *      por GB. Se estima el ahorro contra el tier más conveniente.
 *
 * NOTA de honestidad: sin acceso a la tabla `Usage` (Logs Query API) no
 * podemos medir la ingesta real por tabla. La ingesta diaria se ESTIMA a partir
 * del costo MonthToDate y el precio Pay-As-You-Go de referencia; las filas
 * estimadas se marcan con `estimated: true` y la UI lo aclara. Los precios son
 * de REFERENCIA (USD, orden de magnitud de la lista pública de Azure Monitor) y
 * sirven para priorizar, no para facturar.
 *
 * Regla Cero (precisión): los montos se agregan en centavos enteros
 * (helpers de src/lib/money.ts) para evitar drift de floats.
 */
import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { isMockTenant } from "@/lib/mockData";
import { decimalToCents, centsToDecimal } from "@/lib/money";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import { getResourceCostsById } from "./resourceInventoryService";
import pool from "@/modules/storage/db";

// Precio Pay-As-You-Go de referencia (USD/GB) para Analytics Logs.
const PAYG_PRICE_PER_GB = 2.30;

// Commitment Tiers de referencia: GB/día comprometidos → precio efectivo USD/GB.
// Reflejan el orden de magnitud del descuento escalonado publicado por Azure.
const COMMITMENT_TIERS: Array<{ dailyGb: number; pricePerGb: number }> = [
    { dailyGb: 100, pricePerGb: 1.96 },
    { dailyGb: 200, pricePerGb: 1.84 },
    { dailyGb: 300, pricePerGb: 1.79 },
    { dailyGb: 400, pricePerGb: 1.76 },
    { dailyGb: 500, pricePerGb: 1.73 },
    { dailyGb: 1000, pricePerGb: 1.70 },
    { dailyGb: 2000, pricePerGb: 1.66 },
    { dailyGb: 5000, pricePerGb: 1.61 },
];

// Retención gratuita incluida (días) y precio de retención extendida (USD/GB-mes).
const FREE_RETENTION_DAYS = 31;
const RETENTION_PRICE_PER_GB_MONTH = 0.12;
// Umbral a partir del cual sugerimos revisar la retención.
const RETENTION_REVIEW_THRESHOLD_DAYS = 90;

export type LogAnalyticsRecommendation =
    | "commitment-tier"
    | "reduce-retention"
    | "set-daily-cap"
    | "ok";

export interface LogAnalyticsWorkspaceRow {
    name: string;
    resourceGroup: string;
    subscriptionId: string;
    subscriptionName: string;
    region: string;
    type: string;
    sku: string;
    retentionDays: number;
    dailyQuotaGb: number | null;
    monthlyCost: number;
    estMonthlyIngestionGb: number;
    estDailyIngestionGb: number;
    recommendation: LogAnalyticsRecommendation;
    recommendedTierGb: number | null;
    potentialSaving: number;
    estimated: boolean;
}

export interface LogAnalyticsCostResult {
    subscriptionId: string;
    totalMonthlyCost: number;
    totalPotentialSaving: number;
    workspaceCount: number;
    commitmentTierCandidates: number;
    retentionReviewCandidates: number;
    uncappedWorkspaces: number;
    workspaces: LogAnalyticsWorkspaceRow[];
    ingestionBreakdownAvailable: boolean;
}

function sumMoney(values: number[]): number {
    const cents = values.reduce((acc, v) => acc + decimalToCents(v), 0);
    return centsToDecimal(cents);
}

/** Mejor Commitment Tier alcanzable para una ingesta diaria dada (o null). */
function bestCommitmentTier(dailyGb: number): { dailyGb: number; pricePerGb: number } | null {
    let best: { dailyGb: number; pricePerGb: number } | null = null;
    for (const tier of COMMITMENT_TIERS) {
        if (dailyGb >= tier.dailyGb) best = tier;
    }
    return best;
}

/**
 * Evalúa una fila de workspace y calcula recomendación + ahorro potencial.
 * Toda la aritmética monetaria pasa por centavos enteros.
 */
function evaluateWorkspace(
    input: {
        name: string;
        resourceGroup: string;
        subscriptionId: string;
        subscriptionName: string;
        region: string;
        type: string;
        sku: string;
        retentionDays: number;
        dailyQuotaGb: number | null;
        monthlyCost: number;
        estimated: boolean;
    }
): LogAnalyticsWorkspaceRow {
    const skuLower = (input.sku || "").toLowerCase();
    const isPayg = skuLower === "" || skuLower === "pergb2018" || skuLower === "free" || skuLower === "standalone";

    // Ingesta estimada a partir del costo PAYG (proxy: costo / precio por GB).
    const estMonthlyIngestionGb = isPayg && input.monthlyCost > 0
        ? Math.round((input.monthlyCost / PAYG_PRICE_PER_GB) * 10) / 10
        : 0;
    const estDailyIngestionGb = Math.round((estMonthlyIngestionGb / 30) * 10) / 10;

    let recommendation: LogAnalyticsRecommendation = "ok";
    let recommendedTierGb: number | null = null;
    let potentialSaving = 0;

    // 1) Commitment Tier: solo aplica a PAYG con ingesta diaria que califica.
    const tier = isPayg ? bestCommitmentTier(estDailyIngestionGb) : null;
    if (tier) {
        // Ahorro mensual = ingesta mensual * (precio PAYG - precio tier).
        const deltaCents = Math.round(
            estMonthlyIngestionGb * (PAYG_PRICE_PER_GB - tier.pricePerGb) * 100
        );
        potentialSaving = centsToDecimal(deltaCents);
        recommendation = "commitment-tier";
        recommendedTierGb = tier.dailyGb;
    }

    // 2) Retención excesiva: si supera el umbral, estimar ahorro de recortar al
    //    umbral. Gana sobre commitment-tier solo si el ahorro es mayor.
    if (input.retentionDays > RETENTION_REVIEW_THRESHOLD_DAYS && estMonthlyIngestionGb > 0) {
        const monthsOver = (input.retentionDays - RETENTION_REVIEW_THRESHOLD_DAYS) / 30;
        const retentionSavingCents = Math.round(
            estMonthlyIngestionGb * RETENTION_PRICE_PER_GB_MONTH * monthsOver * 100
        );
        const retentionSaving = centsToDecimal(retentionSavingCents);
        if (retentionSaving > potentialSaving) {
            potentialSaving = retentionSaving;
            recommendation = "reduce-retention";
            recommendedTierGb = null;
        }
    }

    // 3) Sin tope de ingesta diaria: riesgo de ingesta masiva no controlada.
    //    No calculamos ahorro (depende del filtrado), pero lo señalamos si no
    //    hay otra recomendación con ahorro cuantificado.
    if (input.dailyQuotaGb === null && recommendation === "ok" && input.monthlyCost > 0) {
        recommendation = "set-daily-cap";
    }

    return {
        name: input.name,
        resourceGroup: input.resourceGroup,
        subscriptionId: input.subscriptionId,
        subscriptionName: input.subscriptionName,
        region: input.region,
        type: input.type,
        sku: input.sku || "PerGB2018",
        retentionDays: input.retentionDays,
        dailyQuotaGb: input.dailyQuotaGb,
        monthlyCost: input.monthlyCost,
        estMonthlyIngestionGb,
        estDailyIngestionGb,
        recommendation,
        recommendedTierGb,
        potentialSaving,
        estimated: input.estimated,
    };
}

const MOCK_TIER_MULTIPLIER: Record<string, number> = {
    "22222222-3333-4444-5555-666666666666": 3, // pro
    "44444444-5555-6666-7777-888888888888": 10, // business
    "33333333-4444-5555-6666-777777777777": 50, // enterprise
};

function buildMockResult(tenantId: string): LogAnalyticsCostResult {
    const multiplier = MOCK_TIER_MULTIPLIER[tenantId] || 1;
    const base: Array<{ name: string; resourceGroup: string; subscriptionId: string; subscriptionName: string; region: string; type: string; sku: string; retentionDays: number; dailyQuotaGb: number | null; baseCost: number }> = [
        { name: "law-prod-central", resourceGroup: "rg-monitoring", subscriptionId: "demo-sub-01", subscriptionName: "Demo Production Subscription", region: "eastus", type: "microsoft.operationalinsights/workspaces", sku: "PerGB2018", retentionDays: 180, dailyQuotaGb: null, baseCost: 640.0 },
        { name: "law-network-diag", resourceGroup: "rg-network", subscriptionId: "demo-sub-02", subscriptionName: "Demo Operations Subscription", region: "westus2", type: "microsoft.operationalinsights/workspaces", sku: "PerGB2018", retentionDays: 120, dailyQuotaGb: null, baseCost: 380.0 },
        { name: "law-security", resourceGroup: "rg-security", subscriptionId: "demo-sub-04", subscriptionName: "Demo Security Subscription", region: "centralus", type: "microsoft.operationalinsights/workspaces", sku: "PerGB2018", retentionDays: 365, dailyQuotaGb: 50, baseCost: 210.0 },
        { name: "law-apps-dev", resourceGroup: "rg-dev", subscriptionId: "demo-sub-02", subscriptionName: "Demo Operations Subscription", region: "eastus2", type: "microsoft.operationalinsights/workspaces", sku: "PerGB2018", retentionDays: 30, dailyQuotaGb: 10, baseCost: 45.0 },
    ];

    const workspaces = base.map((b) =>
        evaluateWorkspace({
            name: b.name,
            resourceGroup: b.resourceGroup,
            subscriptionId: b.subscriptionId,
            subscriptionName: b.subscriptionName,
            region: b.region,
            type: b.type,
            sku: b.sku,
            retentionDays: b.retentionDays,
            dailyQuotaGb: b.dailyQuotaGb,
            monthlyCost: centsToDecimal(decimalToCents(b.baseCost) * multiplier),
            estimated: true,
        })
    ).sort((a, b) => b.monthlyCost - a.monthlyCost);

    return {
        subscriptionId: "mock-sub",
        totalMonthlyCost: sumMoney(workspaces.map((w) => w.monthlyCost)),
        totalPotentialSaving: sumMoney(workspaces.map((w) => w.potentialSaving)),
        workspaceCount: workspaces.length,
        commitmentTierCandidates: workspaces.filter((w) => w.recommendation === "commitment-tier").length,
        retentionReviewCandidates: workspaces.filter((w) => w.recommendation === "reduce-retention").length,
        uncappedWorkspaces: workspaces.filter((w) => w.dailyQuotaGb === null).length,
        workspaces,
        ingestionBreakdownAvailable: false,
    };
}

export const getLogAnalyticsCost = async (
    tenantId: string,
    subscriptionId: string
): Promise<LogAnalyticsCostResult> => {
    if (isMockTenant(tenantId)) {
        return buildMockResult(tenantId);
    }

    // --- Inventario vía Resource Graph ---
    let rawWorkspaces: any[] = [];
    try {
        const argClient = await getResourceGraphClient(tenantId);
        const query = `
            Resources
            | where type =~ 'microsoft.operationalinsights/workspaces'
            ${subscriptionId ? `| where subscriptionId =~ '${subscriptionId}'` : ""}
            | project name,
                      resourceGroup,
                      subscriptionId,
                      location,
                      type,
                      resourceId = tolower(id),
                      sku = tostring(properties.sku.name),
                      retentionDays = toint(properties.retentionInDays),
                      dailyQuotaGb = todouble(properties.workspaceCapping.dailyQuotaGb)
        `;
        const resARG: any = await argClient.resources({ query, options: { resultFormat: "objectArray", top: 1000 } });
        rawWorkspaces = (resARG.data as any[]) || [];
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        // Error COMPLETO, no sólo `message`: Resource Graph devuelve un texto genérico
        // de soporte (timestamp + correlationId) que no identifica la causa. Ver el
        // mismo comentario en containerAppsCostService.ts.
        const err = e as { code?: string; statusCode?: number; details?: unknown; body?: unknown };
        console.warn(
            `[Log Analytics] No se pudo inventariar para ${tenantId}:`,
            message,
            JSON.stringify({
                code: err?.code,
                statusCode: err?.statusCode,
                details: err?.details,
                body: err?.body,
            })
        );
        return {
            subscriptionId,
            totalMonthlyCost: 0,
            totalPotentialSaving: 0,
            workspaceCount: 0,
            commitmentTierCandidates: 0,
            retentionReviewCandidates: 0,
            uncappedWorkspaces: 0,
            workspaces: [],
            ingestionBreakdownAvailable: false,
        };
    }

    // --- Costo por recurso (MonthToDate) vía el mismo helper compartido que usa
    // Container Apps: filtra por dimensión ResourceId (no ResourceType) y ya
    // resuelve CostUSD vs. PreTaxCost por tenant (ver resolveCostColumn) — la
    // consulta anterior, hecha a mano acá, agregaba por una columna "Cost"
    // literal que Cost Management no siempre expone, y devolvía $0 en
    // silencio aunque el inventario de workspaces sí funcionara.
    const costByResourceId: Record<string, number> = {};
    let subscriptionNameMap = new Map<string, string>();
    try {
        const credential = await getAzureCredential(tenantId);
        subscriptionNameMap = await getSubscriptionNameMap(tenantId, credential);
    } catch {}

    const resourceRefs = rawWorkspaces
        .map((w) => ({ id: String(w.resourceId || "").toLowerCase(), subscriptionId: String(w.subscriptionId || subscriptionId || "") }))
        .filter((r) => r.id && r.subscriptionId);

    if (resourceRefs.length > 0) {
        try {
            const byId = await getResourceCostsById(tenantId, resourceRefs);
            byId.forEach((value, key) => { costByResourceId[key] = value; });
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            console.warn(`[Log Analytics] Sin costo (Cost Management) para ${tenantId}:`, message);
        }
    }

    // Fallback a CostSnapshots (igual que Container Apps): si Cost Management no
    // atribuyó costo a ningún ResourceId (429/degradación transitoria) pero hay
    // gasto sincronizado por el cron, repartirlo en partes iguales entre los
    // workspaces detectados en vez de mostrar $0.
    const totalFromCostMgmt = Object.values(costByResourceId).reduce((acc, v) => acc + v, 0);
    if (totalFromCostMgmt <= 0 && resourceRefs.length > 0 && subscriptionId) {
        try {
            const [rows]: any = await pool.query(
                `SELECT COALESCE(SUM(COALESCE(EffectiveCost, cost_usd, 0)), 0) AS total
                 FROM CostSnapshots
                 WHERE tenant_id = ? AND subscription_id = ?
                   AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
                   AND LOWER(COALESCE(service_name, '')) LIKE '%log analytics%'`,
                [tenantId, subscriptionId]
            );
            const fallbackTotal = Number(rows?.[0]?.total || 0);
            if (fallbackTotal > 0) {
                const evenShare = centsToDecimal(Math.round(decimalToCents(fallbackTotal) / resourceRefs.length));
                for (const r of resourceRefs) costByResourceId[r.id] = evenShare;
            }
        } catch (e: any) {
            console.warn(`[Log Analytics] Snapshot cost fallback falló para ${tenantId}:`, e?.message);
        }
    }

    const workspaces = rawWorkspaces
        .map((w) =>
            evaluateWorkspace({
                name: w.name,
                resourceGroup: w.resourceGroup,
                subscriptionId: String(w.subscriptionId || subscriptionId || ""),
                subscriptionName: resolveSubscriptionName(String(w.subscriptionId || subscriptionId || ""), subscriptionNameMap) || String(w.subscriptionId || subscriptionId || "unknown"),
                region: String(w.location || "unknown"),
                type: String(w.type || "microsoft.operationalinsights/workspaces"),
                sku: w.sku,
                // retentionInDays puede venir como -1 (sin límite) o null.
                retentionDays: Number(w.retentionDays) > 0 ? Number(w.retentionDays) : 0,
                dailyQuotaGb: Number(w.dailyQuotaGb) > 0 ? Number(w.dailyQuotaGb) : null,
                monthlyCost: costByResourceId[String(w.resourceId)] || 0,
                estimated: true,
            })
        )
        .sort((a, b) => b.monthlyCost - a.monthlyCost);

    return {
        subscriptionId,
        totalMonthlyCost: sumMoney(workspaces.map((w) => w.monthlyCost)),
        totalPotentialSaving: sumMoney(workspaces.map((w) => w.potentialSaving)),
        workspaceCount: workspaces.length,
        commitmentTierCandidates: workspaces.filter((w) => w.recommendation === "commitment-tier").length,
        retentionReviewCandidates: workspaces.filter((w) => w.recommendation === "reduce-retention").length,
        uncappedWorkspaces: workspaces.filter((w) => w.dailyQuotaGb === null).length,
        workspaces,
        ingestionBreakdownAvailable: Object.keys(costByResourceId).length > 0,
    };
};
