import { NextRequest, NextResponse } from "next/server";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential } from "@/lib/azure";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { collectAdvisorData } from "@/modules/collectors/azure/advisorCollector";
import { translateAdvisorText } from "@/lib/advisorI18n";
import { parseAzureNumber } from "@/lib/advisorModel";
import pool from "@/modules/storage/db";

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
 *  - Recomendaciones abiertas / ahorro potencial: Azure Advisor (todas las
 *    categorías) + extendedProperties.annualSavingsAmount cuando está.
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

async function getCostFigures(tenantId: string) {
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
    const currentFYCost = Number(rows?.[0]?.currentFY || 0);
    const previousFYCost = Number(rows?.[0]?.previousFY || 0);

    // Proyección simple por run-rate: costo acumulado / días transcurridos del
    // FY * 365. No hay forecasting ML en este repo; es la misma lógica de
    // "proyección" usada en dashboard/summary para el costo del mes.
    const startOfYear = new Date(Date.UTC(currentYear, 0, 1));
    const daysElapsed = Math.max(1, Math.ceil((now.getTime() - startOfYear.getTime()) / 86400000));
    const costProjected = Number(((currentFYCost / daysElapsed) * 365).toFixed(2));

    const [topServices]: any = await pool.query(
        `SELECT service_name AS name, SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS total
         FROM CostSnapshots
         WHERE tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) BETWEEN ? AND ?
         GROUP BY service_name ORDER BY total DESC LIMIT 3`,
        [tenantId, currentFY.start, currentFY.end]
    );

    const months = lastNMonths(3);
    const last3MonthsTrend = [];
    for (const m of months) {
        const [r]: any = await pool.query(
            `SELECT SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS total
             FROM CostSnapshots WHERE tenant_id = ? AND COALESCE(ChargePeriodStart, date) BETWEEN ? AND ?`,
            [tenantId, m.start, m.end]
        );
        last3MonthsTrend.push({ month: m.label, cost: Number(r?.[0]?.total || 0) });
    }

    return {
        currentFYCost: Number(currentFYCost.toFixed(2)),
        previousFYCost: Number(previousFYCost.toFixed(2)),
        costProjected,
        costChangePct: previousFYCost > 0 ? Number((((currentFYCost - previousFYCost) / previousFYCost) * 100).toFixed(1)) : 0,
        top3Services: (topServices as any[]).map(s => ({ name: s.name || "Unknown", cost: Number(s.total) || 0 })),
        last3MonthsTrend,
    };
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

async function getUntaggedResources(tenantId: string, argClient: ResourceGraphClient) {
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

async function getComplianceWins(tenantId: string, argClient: ResourceGraphClient) {
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

async function getTop5(argClient: ResourceGraphClient, tenantId: string, dimension: "location" | "type") {
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

function extractSavings(rec: any): number {
    const raw = rec?.extendedProperties?.annualSavingsAmount || rec?.extendedProperties?.savingsAmount;
    return parseAzureNumber(raw);
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

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        const locale = request.nextUrl.searchParams.get("locale") || "es";
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        // White Board (Dashboard Ejecutivo) disponible para todos los tiers.
        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("white_board", tenantId));
        }

        const cacheKey = `whiteboard:v4:azure:${tenantId}:${locale}`;
        const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
            const argClient = new ResourceGraphClient(await getAzureCredential(tenantId));

            const [
                costFigures,
                costGroups,
                untagged,
                complianceWins,
                top5Locations,
                top5Inventory,
                securityScore,
                advisorData,
                recommendationTrend,
                costAnomalyTrend,
            ] = await Promise.all([
                getCostFigures(tenantId).catch(e => { console.warn("[whiteboard] costFigures:", e.message); return { currentFYCost: 0, previousFYCost: 0, costProjected: 0, costChangePct: 0, top3Services: [], last3MonthsTrend: [] }; }),
                getTop5CostGroups(tenantId).catch(e => { console.warn("[whiteboard] costGroups:", e.message); return { totalCost: 0, groups: [] }; }),
                getUntaggedResources(tenantId, argClient).catch(e => { console.warn("[whiteboard] untagged:", e.message); return { count: 0, total: 0, countPct: 0, cost: 0, costPct: 0, trend: [] }; }),
                getComplianceWins(tenantId, argClient).catch(e => { console.warn("[whiteboard] complianceWins:", e.message); return []; }),
                getTop5(argClient, tenantId, "location").catch(e => { console.warn("[whiteboard] locations:", e.message); return []; }),
                getTop5(argClient, tenantId, "type").catch(e => { console.warn("[whiteboard] inventory:", e.message); return []; }),
                getSecurityScore(tenantId).catch(e => { console.warn("[whiteboard] security:", e.message); return { pct: 0, withMfa: 0, total: 0 }; }),
                collectAdvisorData(tenantId, locale).catch(e => { console.warn("[whiteboard] advisor:", e.message); return { recommendations: { Cost: [], Security: [], HighAvailability: [], Performance: [], OperationalExcellence: [] } }; }),
                getRecommendationTrend(tenantId).catch(e => { console.warn("[whiteboard] recTrend:", e.message); return []; }),
                getCostAnomalyTrend(tenantId).catch(e => { console.warn("[whiteboard] anomalyTrend:", e.message); return []; }),
            ]);

            const allRecs = Object.values(advisorData.recommendations || {}).flat() as any[];
            const securityRecs = (advisorData.recommendations?.Security || []) as any[];

            const vulnerabilities = { high: 0, medium: 0, low: 0 };
            for (const r of securityRecs) {
                const impact = String(r.impact || "").toLowerCase();
                if (impact === "high") vulnerabilities.high++;
                else if (impact === "medium") vulnerabilities.medium++;
                else if (impact === "low") vulnerabilities.low++;
            }

            // "Top 3 Threat Categories" — no hay integración con Defender for
            // Cloud; se usa como proxy el problema (shortDescription.problem) de
            // las recomendaciones de Seguridad de Advisor, agrupado y contado
            // por impact. Es una aproximación honesta, no una fuente de threat
            // intelligence real.
            const threatMap = new Map<string, { high: number; medium: number; low: number }>();
            for (const r of securityRecs) {
                // Sin truncar acá: el recorte a 60 caracteres se aplica después de
                // traducir (ver post-cache más abajo) — truncar el texto en inglés
                // ANTES de intentar el match rompe los patrones de
                // translateAdvisorText en cualquier frase más larga que eso.
                const rawName = r.shortDescription?.problem || r.category || "Security";
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
            const potentialCostSavings = Number(
                ((advisorData.recommendations?.Cost || []) as any[]).reduce((sum, r) => sum + extractSavings(r), 0).toFixed(2)
            );

            return {
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
                costAnomalyTrend,
                top5CostGroups: costGroups,
            };
        }, 3600, 900);

        // Traducción post-cache defensiva para cubrir texto que no quedó
        // localizado por Azure en tiempo de recolección.
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
