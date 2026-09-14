import { NextRequest, NextResponse } from "next/server";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential } from "@/lib/azure";
import { getCostForecast } from "@/modules/collectors/azure/billingService";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getAdvisorExecutiveData, buildAdvisorRemediationCommand } from "@/services/azureAdvisor.service";
import { translateAdvisorText } from "@/lib/advisorI18n";
import { getCurrentMonthAmortizedCosts } from "@/modules/collectors/azure/billingService";
import { redis } from "@/lib/redis";
import pool from "@/modules/storage/db";
import { getInternalBaseUrl } from "@/lib/internalBaseUrl";
import type {
    WhiteboardBudgetEntry,
    WhiteboardQuickWin,
    WhiteboardSummaryMetrics,
    WhiteboardTopService,
} from "@/types/whiteboard.types";

/**
 * White Board — Executive Summary (Enterprise). Agrega en una sola llamada
 * todo lo que necesitan las ~13 tarjetas del tablero. Cada sección se separa
 * en su propio try/catch: un fallo puntual (ej. sin permisos en Advisor)
 * degrada esa tarjeta a valores vacíos en vez de tirar todo el endpoint.
 *
 * Fuentes reales reusadas (no se fabrica ningún dato):
 *  - Costos: CostSnapshots (ya sincronizada por el cron diario).
 *  - Seguridad: mismo cálculo que tenant-health (% Admins con MFA).
 *  - Vulnerabilidades / Amenazas: no hay integración con Microsoft Defender
 *    for Cloud en este repo — se usa como proxy honesto las recomendaciones
 *    de Azure Advisor categoría "Security", agrupadas por su campo `impact`
 *    (High/Medium/Low) nativo de Advisor.
 *  - Recursos sin etiquetar / ubicaciones / inventario: Azure Resource Graph.
 *  - Recomendaciones abiertas / ahorro potencial: getAdvisorExecutiveData
 *    (Azure Advisor ya deduplicado y con ahorros normalizados), la misma
 *    fuente que el panel /governance/advisor, para que los conteos coincidan.
 */

// FY = año calendario actual (no existe concepto de fiscal year custom en
// este repo). Se documenta acá porque es una decisión de producto, no un dato.
function fiscalYearRange(year: number): { start: string; end: string } {
    return { start: `${year}-01-01`, end: `${year}-12-31` };
}

function lastNMonths(n: number): Array<{ start: Date; end: Date; label: string }> {
    const out: Array<{ start: Date; end: Date; label: string }> = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0, 23, 59, 59));
        out.push({ start, end, label: start.toISOString().slice(0, 7) });
    }
    return out;
}

interface CurrentMonthCostAggregation {
    totalUSD: number;
    byService: Map<string, number>;
    byCostCenter: Map<string, number>;
}

function readCostCenter(tags: unknown): string {
    if (!tags) return "Sin asignar";
    try {
        const parsed = typeof tags === "string" ? JSON.parse(tags) : tags;
        if (parsed && typeof parsed === "object") {
            const value = (parsed as Record<string, unknown>).CostCenter;
            if (typeof value === "string" && value.trim()) return value.trim();
        }
    } catch {
        return "Sin asignar";
    }
    return "Sin asignar";
}

async function getCurrentMonthCostAggregation(tenantId: string): Promise<CurrentMonthCostAggregation> {
    let entries: Array<Record<string, unknown>> = [];
    try {
        entries = await getCurrentMonthAmortizedCosts(tenantId, "All", "ActualCost") as unknown as Array<Record<string, unknown>>;
    } catch (error) {
        console.warn("[whiteboard] live Cost Management aggregation failed:", error);
    }

    if (entries.length === 0) {
        try {
            const [rows]: any = await pool.query(
                `SELECT
                    COALESCE(service_name, 'Other') AS serviceName,
                    Tags,
                    COALESCE(EffectiveCost, cost_usd, 0) AS effectiveCost
                 FROM CostSnapshots
                 WHERE tenant_id = ?
                   AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
                [tenantId]
            );
            entries = (rows as Array<Record<string, unknown>>) || [];
        } catch (dbErr) {
            console.warn("[whiteboard] database fallback query failed:", dbErr);
        }
    }

    const byService = new Map<string, number>();
    const byCostCenter = new Map<string, number>();
    let totalUSD = 0;
    for (const entry of entries) {
        const cost = Number(entry.EffectiveCost ?? entry.effectiveCost ?? entry.BilledCost ?? entry.cost_usd ?? 0);
        if (!Number.isFinite(cost)) continue;
        totalUSD += cost;
        const service = String(entry.serviceName ?? entry.service_name ?? entry.ServiceName ?? "Other");
        const costCenter = readCostCenter(entry.Tags ?? entry.tags);
        byService.set(service, (byService.get(service) || 0) + cost);
        byCostCenter.set(costCenter, (byCostCenter.get(costCenter) || 0) + cost);
    }

    return {
        totalUSD: Number(totalUSD.toFixed(2)),
        byService,
        byCostCenter,
    };
}

async function getCostFigures(tenantId: string, currentMonth: CurrentMonthCostAggregation) {
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentFY = fiscalYearRange(currentYear);
    const previousFY = fiscalYearRange(currentYear - 1);

    const [rows]: any = await pool.query(
        `SELECT
            SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) BETWEEN ? AND ? THEN COALESCE(EffectiveCost, cost_usd, 0) ELSE 0 END) AS currentFY,
            SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) BETWEEN ? AND ? THEN COALESCE(EffectiveCost, cost_usd, 0) ELSE 0 END) AS previousFY
         FROM CostSnapshots
         WHERE tenant_id = ?`,
        [currentFY.start, currentFY.end, previousFY.start, previousFY.end, tenantId]
    );
    let currentFYCost = Number(rows?.[0]?.currentFY || 0);
    const previousFYCost = Number(rows?.[0]?.previousFY || 0);

        const costMtdUSD = currentMonth.totalUSD;
        currentFYCost = Math.max(currentFYCost, costMtdUSD);
        const parsedTopServices = [...currentMonth.byService.entries()]
            .map(([name, cost]) => ({ name, cost: Number(cost.toFixed(2)) }))
            .sort((a, b) => b.cost - a.cost)
            .slice(0, 4);

    // PROYECCIÓN A FIN DE MES: la de Azure, no una regla de tres.
    //
    // Esto era `(costMtdUSD / diasTranscurridos) * diasDelMes`, o sea repartir el
    // gasto del mes en partes iguales y multiplicar. Da un número plausible y NO
    // coincide con el que el cliente ve en Cost Management, que es contra el que
    // lo compara: Azure proyecta por día con su propio modelo, no linealmente.
    //
    // `getCostForecast` --que ya existía y sólo usaba /api/intelligence/forecast--
    // devuelve el pronóstico diario de HOY a fin de mes. El EOM es entonces lo
    // gastado (MTD) más los días que faltan; se descarta el día de hoy del
    // pronóstico porque ya está contado dentro del MTD.
    //
    // La regla de tres queda de respaldo: si Azure no responde --sin
    // credenciales, throttling, último día del mes-- se muestra la lineal en vez
    // de un cero. `forecastSource` dice cuál de las dos salió.
    const daysElapsedMonth = Math.max(1, now.getUTCDate());
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const forecastLinealUSD = Number(((costMtdUSD / daysElapsedMonth) * daysInMonth).toFixed(2));

    let forecastEomUSD = forecastLinealUSD;
    let forecastSource: "azure" | "lineal" = "lineal";
    try {
        const pronostico = await getCostForecast(tenantId, "All");
        if (pronostico.length > 0) {
            const hoy = now.toISOString().slice(0, 10);
            const diasQueFaltan = pronostico
                .filter((p) => p.date > hoy)
                .reduce((total, p) => total + (Number(p.forecastCost) || 0), 0);
            forecastEomUSD = Number((costMtdUSD + diasQueFaltan).toFixed(2));
            forecastSource = "azure";
        }
    } catch (e) {
        console.warn("[whiteboard] forecast de Azure no disponible, queda la proyección lineal:", (e as Error)?.message);
    }

    // Proyección FY heredada para compatibilidad con widgets anteriores.
    const startOfYear = new Date(Date.UTC(currentYear, 0, 1));
    const daysElapsed = Math.max(1, Math.ceil((now.getTime() - startOfYear.getTime()) / 86400000));
    const costProjected = Number(((currentFYCost / daysElapsed) * 365).toFixed(2));

    const months = lastNMonths(3);
    const last3MonthsTrend = [];
    for (const m of months) {
        const [r]: any = await pool.query(
            `SELECT SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS total
             FROM CostSnapshots WHERE tenant_id = ? AND COALESCE(ChargePeriodStart, date) BETWEEN ? AND ?`,
            [tenantId, m.start, m.end]
        );
        const mTotal = Number(r?.[0]?.total || 0);
        last3MonthsTrend.push({
            month: m.label,
            cost: mTotal > 0 ? mTotal : (m.label === now.toISOString().slice(0, 7) ? Number(currentFYCost.toFixed(2)) : 0)
        });
    }

    return {
        costMtdUSD: Number(costMtdUSD.toFixed(2)),
        forecastEomUSD,
        forecastSource,
        forecastLinealUSD,
        currentFYCost: Number(currentFYCost.toFixed(2)),
        previousFYCost: Number(previousFYCost.toFixed(2)),
        costProjected,
        costChangePct: previousFYCost > 0 ? Number((((currentFYCost - previousFYCost) / previousFYCost) * 100).toFixed(1)) : 0,
        top3Services: parsedTopServices.slice(0, 3),
        topServices: parsedTopServices,
        last3MonthsTrend,
    };
}

async function getWhiteboardBudgets(
    tenantId: string,
    currentMonth: CurrentMonthCostAggregation
): Promise<WhiteboardBudgetEntry[]> {
    const [rows]: any = await pool.query(
        `SELECT cost_center_name AS costCenterName, monthly_budget_usd AS allocatedBudgetUSD
         FROM CostCenterBudgets WHERE tenant_id = ?`,
        [tenantId]
    );

    return (rows as any[]).map((row) => {
        const budget = Number(row.allocatedBudgetUSD || 0);
        const spend = currentMonth.byCostCenter.get(String(row.costCenterName)) || 0;
        return {
            costCenterName: String(row.costCenterName || "Sin asignar"),
            allocatedBudgetUSD: Number(budget.toFixed(2)),
            currentSpendUSD: Number(spend.toFixed(2)),
            percentageUsed: budget > 0 ? Number(((spend / budget) * 100).toFixed(1)) : 0,
        };
    });
}

async function getExecutiveSummaryMetrics(
    tenantId: string,
    request: NextRequest
): Promise<Pick<WhiteboardSummaryMetrics,
    "zombieResourcesCount" | "zombieMonthlyWasteUSD" | "potentialSavingsUSD" | "carbonKgCO2e">> {
    try {
        const url = new URL(`${getInternalBaseUrl(request.nextUrl.port)}/api/dashboard/summary`);
        url.searchParams.set("tenantId", tenantId);
        url.searchParams.set("subscriptionId", "All");
        // /api/dashboard/summary exige Bearer de usuario o X-Cron-Auth interno:
        // sin forwardear la credencial de esta request devolvia 401 y los KPI de
        // Recursos Zombies e Impacto Ambiental quedaban en 0 permanentemente.
        const headers: Record<string, string> = { "x-forwarded-request": "true" };
        const authHeader = request.headers.get("authorization");
        if (authHeader) headers["Authorization"] = authHeader;
        const cronAuth = request.headers.get("x-cron-auth");
        if (cronAuth) headers["X-Cron-Auth"] = cronAuth;
        const response = await fetch(url, {
            headers,
            cache: "no-store",
        });
        if (!response.ok) throw new Error(`summary ${response.status}`);
        const payload = await response.json();
        return {
            zombieResourcesCount: Number(payload.zombieCount || 0),
            // MEJ-04: antes los dos salían de `payload.totalSavings`, así que
            // el KPI de desperdicio de zombies y el de ahorro potencial
            // mostraban SIEMPRE el mismo número —y el de zombies incluía
            // hallazgos de gobernanza, que no son dinero quemado. El `??` cubre
            // una respuesta vieja cacheada, sin el campo nuevo.
            zombieMonthlyWasteUSD: Number(payload.zombieMonthlyWasteUSD ?? payload.totalSavings) || 0,
            potentialSavingsUSD: Number(payload.detectedWasteUSD ?? payload.totalSavings) || 0,
            carbonKgCO2e: Number(payload.environmentalImpact || 0),
        };
    } catch (error) {
        console.warn("[whiteboard] executive summary enrichment failed:", error);
        return {
            zombieResourcesCount: 0,
            zombieMonthlyWasteUSD: 0,
            potentialSavingsUSD: 0,
            carbonKgCO2e: 0,
        };
    }
}

async function getTop5CostGroups(tenantId: string) {
    const [rows]: any = await pool.query(
        `SELECT COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')), 'null'), 'Untagged') AS name,
                SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS total
         FROM CostSnapshots
         WHERE tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
         GROUP BY name ORDER BY total DESC LIMIT 5`,
        [tenantId]
    );
    const groups = (rows as any[]).map(r => ({ name: r.name, cost: Number(r.total) || 0 }));
    return { totalCost: Number(groups.reduce((s, g) => s + g.cost, 0).toFixed(2)), groups };
}

async function getUntaggedResources(tenantId: string, argClient: ResourceGraphClient | null) {
    if (!argClient) {
        return { count: 0, total: 0, countPct: 0, cost: 0, costPct: 0, trend: [] };
    }
    const query = `
        Resources
        | extend costCenter = tostring(tags.CostCenter)
        | summarize total = count(), untagged = countif(isempty(costCenter))
    `;
    const resp = await argClient.resources({ query, managementGroups: [tenantId] });
    const row = (resp.data as any[])?.[0] || { total: 0, untagged: 0 };
    const total = Number(row.total) || 0;
    const untagged = Number(row.untagged) || 0;
    const pct = total > 0 ? Number(((untagged / total) * 100).toFixed(1)) : 0;

    // Costo real de recursos sin CostCenter, y su % del costo del mes actual.
    const [costRows]: any = await pool.query(
        `SELECT
            SUM(CASE WHEN JSON_EXTRACT(Tags, '$.CostCenter') IS NULL THEN COALESCE(EffectiveCost, cost_usd, 0) ELSE 0 END) AS untaggedCost,
            SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS totalCost
         FROM CostSnapshots
         WHERE tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`,
        [tenantId]
    );
    const untaggedCost = Number(costRows?.[0]?.untaggedCost || 0);
    const totalCost = Number(costRows?.[0]?.totalCost || 0);
    const untaggedCostPct = totalCost > 0 ? Number(((untaggedCost / totalCost) * 100).toFixed(2)) : 0;

    // No guardamos snapshots históricos del ESTADO de tags (solo del costo),
    // así que la "tendencia" de recursos sin etiquetar usa como proxy el
    // costo mensual sin CostCenter de los últimos 3 meses — es un dato real,
    // no inventado, aunque no sea literalmente un conteo de recursos.
    const months = lastNMonths(3);
    const trend = [];
    for (const m of months) {
        const [r]: any = await pool.query(
            `SELECT SUM(CASE WHEN JSON_EXTRACT(Tags, '$.CostCenter') IS NULL THEN COALESCE(EffectiveCost, cost_usd, 0) ELSE 0 END) AS untaggedCost
             FROM CostSnapshots WHERE tenant_id = ? AND COALESCE(ChargePeriodStart, date) BETWEEN ? AND ?`,
            [tenantId, m.start, m.end]
        );
        trend.push({ month: m.label, cost: Number(r?.[0]?.untaggedCost || 0) });
    }

    return { count: untagged, total, countPct: pct, cost: Number(untaggedCost.toFixed(2)), costPct: untaggedCostPct, trend };
}

async function getComplianceWins(tenantId: string, argClient: ResourceGraphClient | null) {
    if (!argClient) return [];
    const query = `
        Resources
        | summarize total = count(),
                    costCenter = countif(isnotempty(tostring(tags.CostCenter))),
                    environment = countif(isnotempty(tostring(tags.Environment))),
                    owner = countif(isnotempty(tostring(tags.Owner)))
    `;
    const resp = await argClient.resources({ query, managementGroups: [tenantId] });
    const row = (resp.data as any[])?.[0] || { total: 0, costCenter: 0, environment: 0, owner: 0 };
    const total = Number(row.total) || 0;
    const pct = (n: number) => (total > 0 ? Number(((n / total) * 100).toFixed(1)) : 0);
    return [
        { name: "CostCenter", pct: pct(Number(row.costCenter) || 0) },
        { name: "Environment", pct: pct(Number(row.environment) || 0) },
        { name: "Owner", pct: pct(Number(row.owner) || 0) },
    ].sort((a, b) => b.pct - a.pct);
}

async function getTop5(argClient: ResourceGraphClient | null, tenantId: string, dimension: "location" | "type") {
    if (!argClient) return [];
    const query = `Resources | summarize count() by ${dimension} | top 5 by count_ desc`;
    const resp = await argClient.resources({ query, managementGroups: [tenantId] });
    return (resp.data as any[] || []).map(r => ({ name: r[dimension] || "unknown", count: Number(r.count_) || 0 }));
}

async function getSecurityScore(tenantId: string) {
    const [rows]: any = await pool.query(
        `SELECT
            SUM(CASE WHEN role IN ('Admin','Owner') THEN 1 ELSE 0 END) AS totalAdmins,
            SUM(CASE WHEN role IN ('Admin','Owner') AND mfa_enabled = 1 THEN 1 ELSE 0 END) AS mfaAdmins
         FROM Users WHERE tenant_id = ?`,
        [tenantId]
    );
    const total = Number(rows?.[0]?.totalAdmins || 0);
    const withMfa = Number(rows?.[0]?.mfaAdmins || 0);
    const pct = total > 0 ? Number(((withMfa / total) * 100).toFixed(1)) : 0;
    return { pct, withMfa, total };
}

async function getRecommendationTrend(tenantId: string) {
    const months = lastNMonths(3);
    const trend = [];
    for (const m of months) {
        const [r]: any = await pool.query(
            `SELECT COUNT(*) AS c FROM RecommendationActions WHERE tenant_id = ? AND status='open' AND created_at BETWEEN ? AND ?`,
            [tenantId, m.start, m.end]
        );
        trend.push({ month: m.label, count: Number(r?.[0]?.c || 0) });
    }
    return trend;
}

// Anomalías por z-score sobre el costo diario ya sincronizado (mismo umbral
// que /api/intelligence/anomalies), agregado a conteo mensual para el gráfico
// de tendencia — evita pegarle de nuevo a la API de Azure Cost Management.
async function getCostAnomalyTrend(tenantId: string) {
    const months = lastNMonths(3);
    const trend = [];
    for (const m of months) {
        const [rows]: any = await pool.query(
            `SELECT DATE(COALESCE(ChargePeriodStart, date)) AS d, SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS total
             FROM CostSnapshots WHERE tenant_id = ? AND COALESCE(ChargePeriodStart, date) BETWEEN ? AND ?
             GROUP BY d`,
            [tenantId, m.start, m.end]
        );
        const values = (rows as any[]).map(r => Number(r.total) || 0);
        const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        const variance = values.length ? values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length : 0;
        const stdDev = Math.sqrt(variance);
        const anomalies = stdDev > 0 ? values.filter(v => (v - mean) / stdDev > 2.5).length : 0;
        trend.push({ month: m.label, count: anomalies });
    }
    return trend;
}

/**
 * Techo de tiempo y medición por fuente del whiteboard.
 *
 * EL 524 (prod, 2026-09-13). El whiteboard ensambla 12 fuentes --Cost
 * Management, cuatro consultas a Resource Graph, Advisor, Graph API y MySQL-- y
 * en caché frío las espera a TODAS de forma sincrónica. Una sola lenta arrastra
 * al resto y el proxy corta la respuesta a los 100 s: el usuario no ve un
 * whiteboard degradado, no ve nada.
 *
 * Cada fuente ya tenía su valor de respaldo para cuando falla; lo que faltaba
 * era que TARDAR contara como fallar. Con el techo, el peor caso del ensamblado
 * pasa de "lo que tarde Azure" a ~25 s y la tarjeta lenta se degrada sola.
 *
 * El tiempo de cada una se loguea siempre, no sólo cuando falla: sin eso, saber
 * cuál de las doce es la lenta era adivinar. Es lo primero que hay que mirar la
 * próxima vez que esto se ponga lento.
 *
 * OJO: `Promise.race` deja de ESPERAR a la fuente, no la cancela --los clientes
 * de Azure no aceptan AbortSignal acá--. La llamada sigue viva hasta que
 * responda; lo que se corta es la espera del usuario.
 */
const TECHO_POR_FUENTE_MS = Number(process.env.WHITEBOARD_SOURCE_TIMEOUT_MS || 25_000);

async function fuente<T>(
    nombre: string,
    respaldo: T,
    fn: () => Promise<T>,
    alDegradar?: () => void
): Promise<T> {
    const t0 = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const conTecho = new Promise<never>((_, rechazar) => {
            timer = setTimeout(() => rechazar(new Error(`superó el techo de ${TECHO_POR_FUENTE_MS} ms`)), TECHO_POR_FUENTE_MS);
        });
        const datos = await Promise.race([fn(), conTecho]);
        console.log(`[whiteboard] fuente=${nombre} ms=${Date.now() - t0} ok`);
        return datos;
    } catch (e) {
        console.warn(`[whiteboard] fuente=${nombre} ms=${Date.now() - t0} degradada: ${(e as Error)?.message || e}`);
        alDegradar?.();
        return respaldo;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        const locale = request.nextUrl.searchParams.get("locale") || "es";
        const forceMock = request.nextUrl.searchParams.get("mock") === "true";
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        if (forceMock || isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("white_board", tenantId));
        }

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        const cacheKey = `whiteboard:v5:azure:${tenantId}:${locale}`;
        const bust = request.nextUrl.searchParams.get("bust") === "1";
        if (bust) {
            try { await redis.del(cacheKey); } catch {}
        }
        const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
            let argClient: ResourceGraphClient | null = null;
            try {
                argClient = new ResourceGraphClient(await getAzureCredential(tenantId));
            } catch (credErr) {
                console.warn("[whiteboard] Azure credential resolution failed:", credErr);
            }
            const ensambladoDesde = Date.now();
            const currentMonth = await getCurrentMonthCostAggregation(tenantId);

            // Si Cost Management tira 429/error en los KPIs de costo, no queremos
            // cachear los $0 degradados con el TTL normal (1h) — dynamicTtl más
            // abajo los cachea 5 min en su lugar para que el próximo refresh del
            // usuario reintente pronto en vez de congelar el número incompleto.
            let costDegraded = false;

            const [
                costFigures,
                costGroups,
                budgets,
                untagged,
                complianceWins,
                top5Locations,
                top5Inventory,
                securityScore,
                advisorData,
                recommendationTrend,
                costAnomalyTrend,
            ] = await Promise.all([
                fuente("costFigures", {
                    costMtdUSD: 0,
                    forecastEomUSD: 0,
                    forecastSource: "lineal" as "azure" | "lineal",
                    forecastLinealUSD: 0,
                    currentFYCost: 0,
                    previousFYCost: 0,
                    costProjected: 0,
                    costChangePct: 0,
                    top3Services: [] as any[],
                    topServices: [] as any[],
                    last3MonthsTrend: [] as any[],
                }, () => getCostFigures(tenantId, currentMonth), () => { costDegraded = true; }),
                fuente("costGroups", { totalCost: 0, groups: [] as any[] }, () => getTop5CostGroups(tenantId), () => { costDegraded = true; }),
                fuente("budgets", [] as any[], () => getWhiteboardBudgets(tenantId, currentMonth)),
                fuente("untagged", { count: 0, total: 0, countPct: 0, cost: 0, costPct: 0, trend: [] as any[] }, () => getUntaggedResources(tenantId, argClient)),
                fuente("complianceWins", [] as any[], () => getComplianceWins(tenantId, argClient)),
                fuente("locations", [] as any[], () => getTop5(argClient, tenantId, "location")),
                fuente("inventory", [] as any[], () => getTop5(argClient, tenantId, "type")),
                fuente("security", { pct: 0, withMfa: 0, total: 0 }, () => getSecurityScore(tenantId)),
                fuente("advisor", null as any, () => getAdvisorExecutiveData(tenantId, locale)),
                fuente("recTrend", [] as any[], () => getRecommendationTrend(tenantId)),
                fuente("anomalyTrend", [] as any[], () => getCostAnomalyTrend(tenantId)),
            ]);

            // Se consume getAdvisorExecutiveData (el mismo servicio que el panel
            // /governance/advisor): ya viene deduplicado por recurso+regla —las
            // variantes de término 1y/3y de una misma reserva colapsan en una
            // sola— y con resourceName/resourceGroup/serviceName reales. Antes se
            // usaba collectAdvisorData crudo, que contaba cada variante y cada
            // recomendación suprimida, inflando los conteos frente a Azure
            // Advisor y repitiendo la misma tarjeta en Quick Wins.
            const isActiveRec = (rec: any) => (rec?.status ?? "active") === "active";
            const advisorRecs: Partial<Record<string, any[]>> = advisorData?.recommendations || {};
            const allRecs = (Object.values(advisorRecs).flat() as any[]).filter(isActiveRec);
            const securityRecs = ((advisorRecs.Security || []) as any[]).filter(isActiveRec);

            const vulnerabilities = { high: 0, medium: 0, low: 0 };
            for (const r of securityRecs) {
                const impact = String(r.impact || "").toLowerCase();
                if (impact === "high") vulnerabilities.high++;
                else if (impact === "medium") vulnerabilities.medium++;
                else if (impact === "low") vulnerabilities.low++;
            }

            // "Top 3 Threat Categories" — no hay integración con Defender for
            // Cloud; se usa como proxy el problema (titleTranslated) de las
            // recomendaciones de Seguridad de Advisor, agrupado y contado por
            // impact. Es una aproximación honesta, no una fuente de threat
            // intelligence real.
            const threatMap = new Map<string, { high: number; medium: number; low: number }>();
            for (const r of securityRecs) {
                // Sin truncar acá: el recorte a 60 caracteres se aplica después de
                // traducir (ver post-cache más abajo) — truncar el texto en inglés
                // ANTES de intentar el match rompe los patrones de
                // translateAdvisorText en cualquier frase más larga que eso.
                const rawName = r.titleTranslated || r.name || r.category || "Security";
                const name = translateAdvisorText(rawName, locale, 'problem');
                const bucket = threatMap.get(name) || { high: 0, medium: 0, low: 0 };
                const impact = String(r.impact || "").toLowerCase();
                if (impact === "high") bucket.high++;
                else if (impact === "medium") bucket.medium++;
                else bucket.low++;
                threatMap.set(name, bucket);
            }
            const top3ThreatCategories = Array.from(threatMap.entries())
                .map(([name, b]) => ({ name, ...b, total: b.high + b.medium + b.low }))
                .sort((a, b) => b.total - a.total)
                .slice(0, 3);

            const openRecommendations = allRecs.length;
            if (recommendationTrend.length > 0) {
                recommendationTrend[recommendationTrend.length - 1].count = openRecommendations;
            }
            const costRecs = ((advisorRecs.Cost || []) as any[]).filter(isActiveRec);
            const potentialCostSavings = Number(
                costRecs.reduce((sum, r) => sum + Number(r.annualSavingsUSD || 0), 0).toFixed(2)
            );

            const executiveEnrichment = await getExecutiveSummaryMetrics(
                tenantId,
                request
            );
            const previousMonthCost = Number(costFigures.last3MonthsTrend?.at(-2)?.cost || 0);
            const momVariationPct = previousMonthCost > 0
                ? Number((((Number(costFigures.costMtdUSD || 0) - previousMonthCost) / previousMonthCost) * 100).toFixed(1))
                : 0;
            const topServices: WhiteboardTopService[] = (costFigures.topServices || []).map((service: any) => ({
                serviceName: String(service.name || "Unknown"),
                monthlyCostUSD: Number(Number(service.cost || 0).toFixed(2)),
                sharePercentage: Number(costFigures.costMtdUSD || 0) > 0
                    ? Number(((Number(service.cost || 0) / Number(costFigures.costMtdUSD)) * 100).toFixed(1))
                    : 0,
            }));
            const advisorPillars = {
                cost: costRecs.length,
                security: securityRecs.length,
                reliability: ((advisorRecs.HighAvailability || []) as any[]).filter(isActiveRec).length,
                performance: ((advisorRecs.Performance || []) as any[]).filter(isActiveRec).length,
            };
            // Quick Wins: el comando de remediación se resuelve con
            // buildAdvisorRemediationCommand (el mismo del panel Advisor), que
            // ramifica por actionType/serviceName real. Antes el widget generaba
            // el script en cliente asumiendo VM siempre, con resourceGroup
            // "rg-prod" inexistente: una recomendación de Redis terminaba
            // mostrando Update-AzVM sobre un GUID.
            const quickWinCandidates: WhiteboardQuickWin[] = allRecs
                .map((rec: any) => {
                    const category = rec.category === "Security"
                        ? "Security"
                        : rec.category === "Cost"
                            ? "Cost"
                            : "Governance";
                    const commands = buildAdvisorRemediationCommand(rec);
                    return {
                        id: String(rec.id || rec.name),
                        title: rec.descriptionTranslated || rec.titleTranslated || rec.name,
                        category,
                        resourceName: rec.resourceName && rec.resourceName !== "—" ? rec.resourceName : "Recurso Azure",
                        resourceGroup: rec.resourceGroup || undefined,
                        resourceType: rec.serviceName || undefined,
                        subscriptionName: rec.subscriptionName || undefined,
                        estimatedMonthlySavingsUSD: Number(rec.monthlySavingsUSD || 0),
                        actionType: rec.actionType || "OPTIMIZE",
                        description: rec.titleTranslated || rec.descriptionTranslated || "",
                        commandCli: commands.cli,
                        commandPowerShell: commands.powerShell,
                    } satisfies WhiteboardQuickWin;
                })
                .sort((a, b) => b.estimatedMonthlySavingsUSD - a.estimatedMonthlySavingsUSD);

            // La tarjeta muestra solo 3 oportunidades: se prioriza una por tipo de
            // recomendación para no llenarla con la misma acción repetida sobre
            // recursos distintos. Si no hay 3 tipos distintos, se rellena con las
            // de mayor ahorro que quedaron fuera.
            const seenTitles = new Set<string>();
            const distinctByTitle = quickWinCandidates.filter((win) => {
                if (seenTitles.has(win.title)) return false;
                seenTitles.add(win.title);
                return true;
            });
            const quickWins: WhiteboardQuickWin[] = [
                ...distinctByTitle,
                ...quickWinCandidates.filter((win) => !distinctByTitle.includes(win)),
            ].slice(0, 4);

            const summary: WhiteboardSummaryMetrics = {
                costMtdUSD: Number(costFigures.costMtdUSD || 0),
                forecastEomUSD: Number(costFigures.forecastEomUSD || 0),
                forecastSource: costFigures.forecastSource,
                zombieCount: Number(executiveEnrichment.zombieResourcesCount || 0),
                zombieSavingsUSD: Number(executiveEnrichment.zombieMonthlyWasteUSD || 0),
                zombieResourcesCount: executiveEnrichment.zombieResourcesCount,
                zombieMonthlyWasteUSD: executiveEnrichment.zombieMonthlyWasteUSD,
                potentialSavingsUSD: Math.max(executiveEnrichment.potentialSavingsUSD, potentialCostSavings / 12),
                carbonKgCO2e: executiveEnrichment.carbonKgCO2e,
                lastSyncDate: new Date().toISOString(),
                cacheTimestamp: new Date().toISOString(),
                momVariationPct,
            };

            const armado = {
                success: true,
                mock: false,
                costs: costFigures,
                security: securityScore,
                vulnerabilities,
                governance: { untagged, top3ComplianceWins: complianceWins },
                top3ThreatCategories,
                top5Locations,
                top5Inventory,
                recommendations: { open: openRecommendations, potentialCostSavings, trend: recommendationTrend },
                summary,
                budgets,
                topServices,
                quickWins,
                advisorPillars,
                // Score oficial de la Advisor Score API (media ponderada por
                // consumo entre suscripciones), el mismo número que muestra
                // /governance/advisor y el portal de Azure.
                advisorScore: Number(advisorData?.overallScore || 0),
                securityActions: securityRecs.slice(0, 3).map((rec: any) =>
                    rec.descriptionTranslated || rec.titleTranslated || "Revisar recomendación"
                ),
                costTrend: (costFigures.last3MonthsTrend || []).map((point: any) => ({
                    month: String(point.month),
                    actualCostUSD: Number(point.cost || 0),
                })),
                tagCoveragePct: Number((100 - Number(untagged.countPct || 0)).toFixed(1)),
                untaggedResourcesCount: Number(untagged.count || 0),
                unallocatedCostUSD: Number(untagged.cost || 0),
                costAnomalyTrend,
                top5CostGroups: costGroups,
                _costDegraded: costDegraded,
            };

            // El total del ensamblado, que es exactamente lo que el 524 tapaba:
            // cuando el proxy corta a los 100 s no queda registro de cuánto
            // tardó ni de quién. Con esto y el `ms=` de cada fuente, la próxima
            // vez se lee en el log en vez de deducirse.
            console.log(
                `[whiteboard] ensamblado tenant=${tenantId} ms=${Date.now() - ensambladoDesde} degradado=${costDegraded}`
            );
            return armado;
        // TTL DURO LARGO, SOFT CORTO. El 524 pasaba sólo con caché VACÍO: mientras
        // haya algo guardado, `getWithStaleWhileRevalidate` devuelve lo viejo al
        // instante y refresca en background. Con el TTL duro en 1 h, cualquier
        // pausa de más de una hora sin visitas dejaba al próximo usuario pagando
        // el ensamblado completo -- y el caso degradado era peor todavía: se
        // guardaba 5 minutos, así que justo cuando Azure venía lento el respaldo
        // duraba menos y el siguiente volvía a esperarlo todo.
        //
        // Ahora el respaldo vive 12 h y el degradado 1 h. El `soft` sigue en 15
        // min, así que el número no se congela: el primero que entre pasados 15
        // minutos ve el valor viejo al instante y dispara la actualización.
        //
        // Y el costo en CERO cuenta como degradado aunque nadie haya tirado un
        // error. Azure Cost Management viene devolviendo 429 de forma crónica:
        // cuando agota los reintentos, `getCostFigures` no falla -- devuelve 0 y
        // sale "ok". Con el respaldo de 12 h, ese cero se quedaba en pantalla
        // medio día. Un tenant sin gasto real revalida cada hora, que es barato;
        // un cero por throttling se corrige en el próximo refresco.
        }, 43200, 900, (result) =>
            result._costDegraded || Number(result?.summary?.costMtdUSD || 0) === 0 ? 3600 : 43200
        );

        // Traducción post-cache defensiva para cubrir texto que no quedó
        // localizado por Azure en tiempo de recolección.
        // `_costDegraded` viaja en la respuesta a propósito: la consume
        // /api/overview/whiteboard (el único caller, server-to-server) para
        // decidir su propio TTL de caché — ver ese archivo.
        const localizedData = {
            ...data,
            top3ThreatCategories: (data.top3ThreatCategories || []).map((cat: any) => ({
                ...cat,
                name: translateAdvisorText(cat.name, locale, 'problem').slice(0, 60),
            })),
        };

        return NextResponse.json(localizedData);
    } catch (err: unknown) {
        if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
        console.error("[whiteboard] error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
