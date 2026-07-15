/**
 * GET /api/cost-groups/[name] — drill-through de un Cost Group puntual
 * (Current FY, Costs, Actions, Resources, Governance).
 *
 * [name] es el valor del tag CostCenter (URL-encoded). Reusa las mismas
 * fuentes que /api/cost-groups y /api/intelligence/whiteboard: CostSnapshots
 * (costos), Budgets (presupuesto), CostGroups (metadata), Resource Graph
 * (recursos/ubicaciones/tag coverage) y Advisor (recomendaciones), todas
 * filtradas por el tag CostCenter = name.
 */
import { NextRequest, NextResponse } from "next/server";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential } from "@/lib/azure";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockCostGroupDetail } from "@/lib/mockData";
import { collectAdvisorData } from "@/modules/collectors/azure/advisorCollector";
import { getSubscriptionNameMap, resolveSubscriptionName, isUnattributedSubscriptionId } from "@/lib/azureSubscriptionNames";
import pool from "@/modules/storage/db";

function escapeKql(s: string): string {
    // Orden importa: escapar `\` primero (el propio carácter de escape KQL)
    // y recién después `'` — si se hiciera al revés, un valor terminado en
    // `\` podría "consumir" la comilla de escape recién insertada y romper
    // el string literal, permitiendo inyección KQL. Blast radius era bajo
    // (KQL scopeado al management group del propio tenant, no cruza
    // tenants) pero igual corresponde el escape robusto.
    return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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

async function getCurrentFY(tenantId: string, name: string, budget: number) {
    const now = new Date();
    const fyStart = `${now.getUTCFullYear()}-01-01`;
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);

    const isUntagged = name === "Untagged/Unknown";
    const tagFilter = isUntagged
        ? `(JSON_EXTRACT(Tags, '$.CostCenter') IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')) = 'null')`
        : `JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')) = ?`;
    const params = isUntagged ? [tenantId] : [tenantId, name];

    const [rows]: any = await pool.query(
        `SELECT
            SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) >= ? THEN COALESCE(EffectiveCost, BilledCost, cost_usd, 0) ELSE 0 END) AS actualCostToDateFY,
            SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) >= ? THEN COALESCE(EffectiveCost, BilledCost, cost_usd, 0) ELSE 0 END) AS currentMonthActualCost,
            COUNT(DISTINCT CASE WHEN subscription_id NOT IN ('mg-aggregated', 'default') THEN subscription_id END) AS subscriptions,
            COUNT(DISTINCT resource_group) AS resourceGroups
         FROM CostSnapshots WHERE tenant_id = ? AND ${tagFilter}`,
        [fyStart, monthStart, ...params]
    );
    const r = rows?.[0] || {};
    const daysElapsedMonth = Math.max(1, now.getUTCDate());
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const currentMonthActualCost = Number(r.currentMonthActualCost) || 0;
    const currentMonthForecast = Number(((currentMonthActualCost / daysElapsedMonth) * daysInMonth).toFixed(2));

    // Excluye subscription_id = 'mg-aggregated'/'default' del desglose (ver
    // azureSubscriptionNames.ts) — se separan en unattributedCost en vez de
    // mostrarse como si fueran una suscripción real.
    const [subRows]: any = await pool.query(
        `SELECT subscription_id AS name, SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS cost
         FROM CostSnapshots WHERE tenant_id = ? AND ${tagFilter} AND DATE(COALESCE(ChargePeriodStart, date)) >= ?
         GROUP BY subscription_id ORDER BY cost DESC`,
        [...params, monthStart]
    );
    const allSubs = (subRows as any[]).map(s => ({ name: s.name as string, cost: Number(s.cost) || 0 }));
    const subscriptionBreakdown = allSubs.filter(s => !isUnattributedSubscriptionId(s.name));
    const unattributedSubscriptionCost = Number(
        allSubs.filter(s => isUnattributedSubscriptionId(s.name)).reduce((sum, s) => sum + s.cost, 0).toFixed(2)
    );

    return {
        actualCostToDateFY: Number((Number(r.actualCostToDateFY) || 0).toFixed(2)),
        currentMonthActualCost: Number(currentMonthActualCost.toFixed(2)),
        monthlyBudget: Number(budget.toFixed(2)),
        currentMonthForecast,
        subscriptionBreakdown,
        unattributedSubscriptionCost,
        subscriptionsCount: Number(r.subscriptions) || 0,
        resourceGroupsCount: Number(r.resourceGroups) || 0,
        _tagFilter: tagFilter,
        _params: params,
    };
}

async function getMonthlyCostTrend(tenantId: string, name: string, budget: number, tagFilter: string, params: any[]) {
    const months = lastNMonths(6);
    const now = new Date();
    const out = [];
    for (const m of months) {
        const [rows]: any = await pool.query(
            `SELECT SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS total
             FROM CostSnapshots WHERE tenant_id = ? AND ${tagFilter} AND COALESCE(ChargePeriodStart, date) BETWEEN ? AND ?`,
            [...params, m.start, m.end]
        );
        const actual = Number(rows?.[0]?.total) || 0;
        const isCurrentMonth = m.start.getUTCFullYear() === now.getUTCFullYear() && m.start.getUTCMonth() === now.getUTCMonth();
        const daysElapsed = Math.max(1, now.getUTCDate());
        const daysInMonth = new Date(Date.UTC(m.start.getUTCFullYear(), m.start.getUTCMonth() + 1, 0)).getUTCDate();
        const forecast = isCurrentMonth ? Number(((actual / daysElapsed) * daysInMonth).toFixed(2)) : null;
        out.push({ month: m.label, actual: Number(actual.toFixed(2)), budget: Number(budget.toFixed(2)), forecast });
    }
    return out;
}

async function getAnomalyCount(tenantId: string, tagFilter: string, params: any[]) {
    const [rows]: any = await pool.query(
        `SELECT DATE(COALESCE(ChargePeriodStart, date)) AS d, SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS total
         FROM CostSnapshots WHERE tenant_id = ? AND ${tagFilter} AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         GROUP BY d`,
        params
    );
    const values = (rows as any[]).map(r => Number(r.total) || 0);
    if (values.length < 3) return 0;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    return stdDev > 0 ? values.filter(v => (v - mean) / stdDev > 2.5).length : 0;
}

// Pestaña Costs — comparativa de período (30d vs 30d previos) y de FY
// (proyección run-rate vs FY anterior completo), mismo enfoque de proyección
// simple que getCostFigures en /api/intelligence/whiteboard (no hay ML de
// forecasting en este repo).
async function getPeriodComparison(tenantId: string, tagFilter: string, params: any[], budget: number) {
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const periodEnd = now.toISOString().slice(0, 10);
    const periodStart = new Date(now); periodStart.setUTCDate(periodStart.getUTCDate() - 30);
    const prevPeriodEnd = new Date(periodStart); prevPeriodEnd.setUTCDate(prevPeriodEnd.getUTCDate() - 1);
    const prevPeriodStart = new Date(prevPeriodEnd); prevPeriodStart.setUTCDate(prevPeriodStart.getUTCDate() - 30);

    const [rows]: any = await pool.query(
        `SELECT
            SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) BETWEEN ? AND ? THEN COALESCE(EffectiveCost, cost_usd, 0) ELSE 0 END) AS periodCost,
            SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) BETWEEN ? AND ? THEN COALESCE(EffectiveCost, cost_usd, 0) ELSE 0 END) AS previousPeriodCost,
            SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) BETWEEN ? AND ? THEN COALESCE(EffectiveCost, cost_usd, 0) ELSE 0 END) AS currentFYCost,
            SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) BETWEEN ? AND ? THEN COALESCE(EffectiveCost, cost_usd, 0) ELSE 0 END) AS previousFYCost
         FROM CostSnapshots WHERE tenant_id = ? AND ${tagFilter}`,
        [
            periodStart.toISOString().slice(0, 10), periodEnd,
            prevPeriodStart.toISOString().slice(0, 10), prevPeriodEnd.toISOString().slice(0, 10),
            `${currentYear}-01-01`, periodEnd,
            `${currentYear - 1}-01-01`, `${currentYear - 1}-12-31`,
            ...params,
        ]
    );
    const r = rows?.[0] || {};
    const periodCost = Number(r.periodCost) || 0;
    const previousPeriodCost = Number(r.previousPeriodCost) || 0;
    const currentFYCost = Number(r.currentFYCost) || 0;
    const previousFYCost = Number(r.previousFYCost) || 0;

    const startOfYear = new Date(Date.UTC(currentYear, 0, 1));
    const daysElapsed = Math.max(1, Math.ceil((now.getTime() - startOfYear.getTime()) / 86400000));
    const projectedFYCost = Number(((currentFYCost / daysElapsed) * 365).toFixed(2));

    return {
        periodCost: Number(periodCost.toFixed(2)),
        previousPeriodCost: Number(previousPeriodCost.toFixed(2)),
        periodChangePct: previousPeriodCost > 0 ? Number((((periodCost - previousPeriodCost) / previousPeriodCost) * 100).toFixed(1)) : 0,
        projectedFYCost,
        previousFYCost: Number(previousFYCost.toFixed(2)),
        fyChangePct: previousFYCost > 0 ? Number((((projectedFYCost - previousFYCost) / previousFYCost) * 100).toFixed(1)) : 0,
        monthlyBudget: Number(budget.toFixed(2)),
    };
}

async function getTopBreakdown(tenantId: string, tagFilter: string, params: any[], column: string, limit = 6) {
    const [rows]: any = await pool.query(
        `SELECT COALESCE(NULLIF(${column}, ''), 'Unknown') AS name, SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS cost
         FROM CostSnapshots WHERE tenant_id = ? AND ${tagFilter} AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
         GROUP BY name ORDER BY cost DESC`,
        params
    );
    const all = (rows as any[]).map(r => ({ name: r.name, cost: Number(r.cost) || 0 })).filter(r => r.cost > 0);
    const top = all.slice(0, limit);
    const rest = all.slice(limit).reduce((s, r) => s + r.cost, 0);
    if (rest > 0) top.push({ name: "Other", cost: Number(rest.toFixed(2)) });
    return top.map(r => ({ ...r, cost: Number(r.cost.toFixed(2)) }));
}

async function getSubscriptionTrend(tenantId: string, tagFilter: string, params: any[]) {
    const months = lastNMonths(3);
    const out: Array<Record<string, any>> = [];
    for (const m of months) {
        const [rows]: any = await pool.query(
            `SELECT subscription_id AS name, SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS cost
             FROM CostSnapshots WHERE tenant_id = ? AND ${tagFilter} AND COALESCE(ChargePeriodStart, date) BETWEEN ? AND ?
             GROUP BY subscription_id`,
            [...params, m.start, m.end]
        );
        const point: Record<string, any> = { month: m.label };
        for (const row of rows as any[]) {
            if (isUnattributedSubscriptionId(row.name)) continue;
            point[row.name] = Number(row.cost) || 0;
        }
        out.push(point);
    }
    return out;
}

// Pestaña Actions — anomalías de costo con detalle "antes/después". CostSnapshots
// no tiene ResourceId poblado para tenants Azure (sólo AWS), así que la
// granularidad más fina disponible sin fabricar datos es (resource_group,
// service_name) día a día — se usa z-score sobre esa serie diaria.
async function getCostAnomaliesDetailed(tenantId: string, name: string, tagFilter: string, params: any[]) {
    const [rows]: any = await pool.query(
        `SELECT DATE(COALESCE(ChargePeriodStart, date)) AS d, resource_group AS resourceGroup, subscription_id AS subscription,
                service_name AS service, SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS total
         FROM CostSnapshots WHERE tenant_id = ? AND ${tagFilter} AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 45 DAY)
         GROUP BY d, resourceGroup, subscription, service ORDER BY d ASC`,
        params
    );
    const series = new Map<string, Array<{ d: string; total: number; resourceGroup: string; subscription: string; service: string }>>();
    for (const r of rows as any[]) {
        const key = `${r.resourceGroup}::${r.subscription}::${r.service}`;
        if (!series.has(key)) series.set(key, []);
        series.get(key)!.push({ d: r.d, total: Number(r.total) || 0, resourceGroup: r.resourceGroup, subscription: r.subscription, service: r.service });
    }
    const anomalies: any[] = [];
    for (const points of series.values()) {
        if (points.length < 5) continue;
        const values = points.map(p => p.total);
        const mean = values.reduce((s, v) => s + v, 0) / values.length;
        const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);
        if (stdDev <= 0) continue;
        for (let i = 1; i < points.length; i++) {
            const z = (points[i].total - mean) / stdDev;
            if (z > 2.5 && points[i].total > points[i - 1].total) {
                const prev = points[i - 1].total;
                const curr = points[i].total;
                anomalies.push({
                    date: points[i].d,
                    resource: points[i].service,
                    previousCost: Number(prev.toFixed(2)),
                    newCost: Number(curr.toFixed(2)),
                    costChange: Number((curr - prev).toFixed(2)),
                    pctChange: prev > 0 ? Number((((curr - prev) / prev) * 100).toFixed(1)) : 0,
                    costGroup: name,
                    subscription: points[i].subscription,
                    resourceGroup: points[i].resourceGroup,
                });
            }
        }
    }
    return anomalies.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 100);
}

async function getResourceGroupsTab(tenantId: string, tagFilter: string, params: any[], resourceGroupSet: Set<string>, argClient: any, tenantMgmtId: string) {
    const [rows]: any = await pool.query(
        `SELECT resource_group AS resourceGroup,
                SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS periodCost,
                COUNT(DISTINCT DATE(COALESCE(ChargePeriodStart, date))) AS days,
                COUNT(DISTINCT CASE WHEN subscription_id NOT IN ('mg-aggregated', 'default') THEN subscription_id END) AS subscriptions
         FROM CostSnapshots WHERE tenant_id = ? AND ${tagFilter} AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
         GROUP BY resourceGroup ORDER BY periodCost DESC`,
        params
    );

    const ownerByRg = new Map<string, string>();
    if (resourceGroupSet.size > 0) {
        try {
            const rgResp = await argClient.resources({
                query: `ResourceContainers | where type =~ 'microsoft.resources/subscriptions/resourcegroups' | project name, tags`,
                managementGroups: [tenantMgmtId],
            });
            for (const rg of (rgResp.data as any[]) || []) {
                const owner = rg.tags?.Owner || rg.tags?.owner;
                if (owner) ownerByRg.set(String(rg.name).toLowerCase(), owner);
            }
        } catch (e: any) {
            console.warn("[cost-groups/detail] resourceContainers:", e.message);
        }
    }

    return (rows as any[]).map(r => {
        const days = Math.max(1, Number(r.days) || 1);
        const periodCost = Number(r.periodCost) || 0;
        return {
            resourceGroup: r.resourceGroup,
            avgDailyCost: Number((periodCost / days).toFixed(2)),
            periodCost: Number(periodCost.toFixed(2)),
            subscriptions: Number(r.subscriptions) || 0,
            owner: ownerByRg.get(String(r.resourceGroup).toLowerCase()) || null,
            createdDate: null,
            createdBy: null,
        };
    });
}

// Pestaña Governance — Audit Logs. No existe un concepto de "campo
// modificado antes/después" en ActionLogs (ver tabla en db.ts): se
// repurpone honestamente From=usuario que ejecutó la acción, To=resultado
// (status), Subject=tipo de acción, sin inventar un diff que no existe.
async function getAuditLogs(tenantId: string, resourceGroupSet: Set<string>) {
    if (resourceGroupSet.size === 0) return [];
    const conditions = Array.from(resourceGroupSet).map(() => `resource_id LIKE ?`).join(" OR ");
    const likeParams = Array.from(resourceGroupSet).map(rg => `%/resourceGroups/${rg}/%`);
    const [rows]: any = await pool.query(
        `SELECT timestamp, user_email, action_type, resource_id, resource_type, status, details
         FROM ActionLogs WHERE tenant_id = ? AND (${conditions})
         ORDER BY timestamp DESC LIMIT 100`,
        [tenantId, ...likeParams]
    );
    return (rows as any[]).map(r => ({
        date: r.timestamp,
        from: r.user_email,
        to: r.status,
        subject: r.action_type,
        resource: String(r.resource_id || "").split("/").pop() || r.resource_id,
        comment: r.details || "—",
    }));
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
    try {
        const { name: rawName } = await params;
        const name = decodeURIComponent(rawName);
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const locale = url.searchParams.get("locale") || "es";
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        // Cost Groups es exclusivo de los planes Business y Enterprise.
        await requireTenantTier(request, tenantId, "Business");

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockCostGroupDetail(name, "enterprise"));
        }

        const [budgetRows]: any = await pool.query(
            `SELECT monthly_limit_usd FROM Budgets WHERE tenant_id = ? AND cost_center_tag_value = ?`,
            [tenantId, name]
        );
        const budget = Number(budgetRows?.[0]?.monthly_limit_usd) || 0;

        const [metaRows]: any = await pool.query(
            `SELECT cg.description, cg.created_by, cg.created_at, u.display_name AS ownerName, u.email AS ownerEmail
             FROM CostGroups cg LEFT JOIN Users u ON u.id = cg.owner_user_id
             WHERE cg.tenant_id = ? AND cg.name = ?`,
            [tenantId, name]
        );
        const meta = metaRows?.[0] || {};

        const currentFYRaw = await getCurrentFY(tenantId, name, budget).catch(e => {
            console.warn("[cost-groups/detail] currentFY:", e.message);
            return { actualCostToDateFY: 0, currentMonthActualCost: 0, monthlyBudget: budget, currentMonthForecast: 0, subscriptionBreakdown: [], subscriptionsCount: 0, resourceGroupsCount: 0, _tagFilter: "1=0", _params: [] as any[] };
        });
        const { _tagFilter: tagFilter, _params: tagParams, ...currentFY } = currentFYRaw;

        const escapedName = escapeKql(name);
        const kqlTagFilter = name === "Untagged/Unknown"
            ? `isempty(tostring(tags.CostCenter))`
            : `tostring(tags.CostCenter) =~ '${escapedName}'`;

        let resourcesResult: any[] = [];
        let locations: Array<{ region: string; resources: number }> = [];
        let governance = { resourcesTotal: 0, tagCoverage: [] as Array<{ name: string; pct: number }> };
        let argClient: any = null;
        let credential: any = null;

        try {
            credential = await getAzureCredential(tenantId);
            argClient = new ResourceGraphClient(credential);

            const resResp = await argClient.resources({
                query: `Resources | where ${kqlTagFilter} | project name, type, location, resourceGroup, subscriptionId | limit 200`,
                managementGroups: [tenantId],
            });
            resourcesResult = (resResp.data as any[]) || [];

            const locResp = await argClient.resources({
                query: `Resources | where ${kqlTagFilter} | summarize count() by location`,
                managementGroups: [tenantId],
            });
            locations = ((locResp.data as any[]) || []).map(r => ({ region: r.location || "unknown", resources: Number(r.count_) || 0 }));

            const govResp = await argClient.resources({
                query: `Resources | where ${kqlTagFilter} | summarize total = count(), environment = countif(isnotempty(tostring(tags.Environment))), owner = countif(isnotempty(tostring(tags.Owner)))`,
                managementGroups: [tenantId],
            });
            const govRow = (govResp.data as any[])?.[0] || { total: 0, environment: 0, owner: 0 };
            const total = Number(govRow.total) || 0;
            const pct = (n: number) => (total > 0 ? Number(((n / total) * 100).toFixed(1)) : 0);
            governance = {
                resourcesTotal: total,
                tagCoverage: [
                    { name: "Environment", pct: pct(Number(govRow.environment) || 0) },
                    { name: "Owner", pct: pct(Number(govRow.owner) || 0) },
                    { name: "CostCenter", pct: name === "Untagged/Unknown" ? 0 : 100 },
                ],
            };
        } catch (e: any) {
            console.warn("[cost-groups/detail] resource graph:", e.message);
        }

        const resourceGroupSet = new Set(resourcesResult.map(r => String(r.resourceGroup || "").toLowerCase()));

        const [
            monthlyCost, costAnomaliesCount, periodComparison, byService, byMeter, byServiceCategory,
            subscriptionTrendRaw, costAnomaliesRaw, resourceGroupsTab, auditLogs, subMap,
        ] = await Promise.all([
            getMonthlyCostTrend(tenantId, name, budget, tagFilter, tagParams).catch(e => { console.warn("[cost-groups/detail] monthlyCost:", e.message); return []; }),
            getAnomalyCount(tenantId, tagFilter, tagParams).catch(e => { console.warn("[cost-groups/detail] anomalies:", e.message); return 0; }),
            getPeriodComparison(tenantId, tagFilter, tagParams, budget).catch(e => { console.warn("[cost-groups/detail] periodComparison:", e.message); return null; }),
            getTopBreakdown(tenantId, tagFilter, tagParams, "service_name").catch(e => { console.warn("[cost-groups/detail] byService:", e.message); return []; }),
            getTopBreakdown(tenantId, tagFilter, tagParams, "MeterName").catch(e => { console.warn("[cost-groups/detail] byMeter:", e.message); return []; }),
            getTopBreakdown(tenantId, tagFilter, tagParams, "ServiceFamily").catch(e => { console.warn("[cost-groups/detail] byServiceCategory:", e.message); return []; }),
            getSubscriptionTrend(tenantId, tagFilter, tagParams).catch(e => { console.warn("[cost-groups/detail] subscriptionTrend:", e.message); return []; }),
            getCostAnomaliesDetailed(tenantId, name, tagFilter, tagParams).catch(e => { console.warn("[cost-groups/detail] costAnomaliesDetailed:", e.message); return []; }),
            getResourceGroupsTab(tenantId, tagFilter, tagParams, resourceGroupSet, argClient, tenantId).catch(e => { console.warn("[cost-groups/detail] resourceGroupsTab:", e.message); return []; }),
            getAuditLogs(tenantId, resourceGroupSet).catch(e => { console.warn("[cost-groups/detail] auditLogs:", e.message); return []; }),
            credential ? getSubscriptionNameMap(tenantId, credential) : Promise.resolve(new Map<string, string>()),
        ]);

        // CostSnapshots sólo tiene subscription_id (GUID); se resuelve a
        // displayName acá (una sola vez) en vez de en cada helper de arriba.
        currentFY.subscriptionBreakdown = (currentFY.subscriptionBreakdown as any[]).map(s => ({ ...s, name: resolveSubscriptionName(s.name, subMap) }));
        const subscriptionTrend = subscriptionTrendRaw.map((point: Record<string, any>) => {
            const mapped: Record<string, any> = { month: point.month };
            for (const [k, v] of Object.entries(point)) if (k !== "month") mapped[resolveSubscriptionName(k, subMap)] = v;
            return mapped;
        });
        const costAnomalies = costAnomaliesRaw.map((a: any) => ({ ...a, subscription: resolveSubscriptionName(a.subscription, subMap) }));

        let actions: any[] = [];
        let monthlySaving = 0;
        try {
            const advisorData = await collectAdvisorData(tenantId, locale);
            const allRecs = Object.entries(advisorData.recommendations || {}).flatMap(([category, recs]: [string, any]) =>
                (recs as any[]).map(r => ({ ...r, _category: category }))
            );
            const scoped = resourceGroupSet.size > 0
                ? allRecs.filter(r => {
                    const rid = String(r.resourceMetadata?.resourceId || r.resourceId || "");
                    const match = rid.match(/\/resourceGroups\/([^/]+)\//i);
                    return match ? resourceGroupSet.has(match[1].toLowerCase()) : false;
                })
                : [];
            actions = scoped.map(r => {
                const savings = Number(r.extendedProperties?.annualSavingsAmount || r.extendedProperties?.savingsAmount) || 0;
                const rid = String(r.resourceMetadata?.resourceId || r.resourceId || "");
                const rgMatch = rid.match(/\/resourceGroups\/([^/]+)\//i);
                return {
                    id: r.recommendationId || r.id || `${r._category}-${r.shortDescription?.solution || ""}`,
                    title: r.shortDescription?.solution || r.shortDescription?.problem || r._category,
                    category: r._category,
                    impact: r.impact || "Low",
                    resource: rid.split("/").pop() || "",
                    resourceGroup: rgMatch ? rgMatch[1] : "",
                    subscription: resolveSubscriptionName(r.subscriptionId, subMap),
                    potentialSavingsMonthly: Number((savings / 12).toFixed(2)),
                };
            });
            monthlySaving = Number(actions.reduce((s, a) => s + (a.potentialSavingsMonthly || 0), 0).toFixed(2));
        } catch (e: any) {
            console.warn("[cost-groups/detail] advisor:", e.message);
        }

        return NextResponse.json({
            success: true,
            mock: false,
            name,
            description: meta.description || null,
            owner: meta.ownerName || meta.ownerEmail || null,
            createdBy: meta.created_by || null,
            createdAt: meta.created_at || null,
            lastUpdated: new Date().toISOString(),
            currentFY: {
                ...currentFY,
                monthlySaving,
                recommendationsCount: actions.length,
                costAnomaliesCount,
            },
            costs: {
                monthlyCost,
                locations,
                periodComparison,
                byService,
                byMeter,
                byServiceCategory,
                subscriptionTrend,
            },
            actions: {
                costAnomaliesCount: costAnomalies.length,
                recommendationsCount: actions.length,
                monthlySaving,
                costAnomalies,
                recommendations: actions,
            },
            resources: {
                resourceGroupsCount: resourceGroupsTab.length,
                resourceGroups: resourceGroupsTab,
            },
            governance: {
                ...governance,
                auditLogsCount: auditLogs.length,
                auditLogs,
            },
        });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[cost-groups/detail] GET error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
