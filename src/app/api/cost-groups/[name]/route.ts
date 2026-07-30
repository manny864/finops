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
import { requireTenantTier, requireTenantRole, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockCostGroupDetail } from "@/lib/mockData";
import { collectAdvisorData } from "@/modules/collectors/azure/advisorCollector";
import { translateAdvisorText } from "@/lib/advisorI18n";
import { getSubscriptionNameMap, resolveSubscriptionName, isUnattributedSubscriptionId } from "@/lib/azureSubscriptionNames";
import pool from "@/modules/storage/db";
import { invalidateCache, costGroupsCacheKeys } from "@/lib/cache";
import {
    getAnomalyCount,
    getCurrentFY,
    getMonthlyCostTrend,
    getPeriodComparison,
    getTopBreakdown,
} from "@/services/costGroupDetailMetricsService";

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
// no tiene ResourceId poblado (el sync agrega por resource group), así que la
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

/**
 * Resuelve el predicado de membresía de un Cost Group, tanto para
 * CostSnapshots (SQL) como para Resource Graph (KQL) — legacy (tag
 * CostCenter) o custom (regla propia + asignación manual, ver
 * migrations/20260717-001-cost-groups-custom-rules.sql).
 *
 * Para grupos custom, ambos motores (SQL y KQL) matchean contra el MISMO
 * conjunto resuelto de resource_group — CostSnapshots no tiene ResourceId
 * poblado para tenants Azure, así que ese es el grano más fino que se puede
 * agregar de forma confiable, y usar el mismo conjunto en los dos lados
 * evita que "costo" y "recursos mostrados" cuenten cosas distintas.
 */
async function resolveGroupFilters(tenantId: string, name: string, meta: any) {
    if (meta?.match_type == null) {
        const isUntagged = name === "Untagged/Unknown";
        const tagFilter = isUntagged
            ? `(JSON_EXTRACT(Tags, '$.CostCenter') IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')) = 'null')`
            : `JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')) = ?`;
        const tagParams = isUntagged ? [tenantId] : [tenantId, name];
        const escapedName = escapeKql(name);
        const kqlTagFilter = isUntagged
            ? `isempty(tostring(tags.CostCenter))`
            : `tostring(tags.CostCenter) =~ '${escapedName}'`;
        return { tagFilter, tagParams, kqlTagFilter, isCustom: false, matchType: null as string | null, resourceGroups: [] as string[] };
    }

    const patternPredicate = meta.match_type === "name_pattern"
        ? "resource_group LIKE ?"
        : "JSON_UNQUOTE(JSON_EXTRACT(Tags, CONCAT('$.', ?))) = ?";
    const patternParams = meta.match_type === "name_pattern"
        ? [meta.match_rg_pattern]
        : [meta.match_tag_key, meta.match_tag_value];

    const [matchedRows]: any = await pool.query(
        `SELECT DISTINCT resource_group FROM CostSnapshots WHERE tenant_id = ? AND (${patternPredicate})`,
        [tenantId, ...patternParams]
    );
    const [manualRows]: any = await pool.query(
        `SELECT resource_group FROM CostGroupResourceGroups WHERE tenant_id = ? AND group_name = ?`,
        [tenantId, name]
    );
    const resourceGroups = Array.from(new Set([
        ...(matchedRows as any[]).map(r => r.resource_group),
        ...(manualRows as any[]).map(r => r.resource_group),
    ]));

    const tagFilter = resourceGroups.length > 0
        ? `resource_group IN (${resourceGroups.map(() => "?").join(",")})`
        : "1=0";
    const kqlTagFilter = resourceGroups.length > 0
        ? `resourceGroup in~ (${resourceGroups.map(rg => `'${escapeKql(rg)}'`).join(",")})`
        : "false";

    return { tagFilter, tagParams: [tenantId, ...resourceGroups], kqlTagFilter, isCustom: true, matchType: meta.match_type as string, resourceGroups };
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
            `SELECT cg.description, cg.match_type, cg.match_tag_key, cg.match_tag_value, cg.match_rg_pattern,
                    cg.created_by, cg.created_at, u.display_name AS ownerName, u.email AS ownerEmail
             FROM CostGroups cg LEFT JOIN Users u ON u.id = cg.owner_user_id
             WHERE cg.tenant_id = ? AND cg.name = ?`,
            [tenantId, name]
        );
        const meta = metaRows?.[0] || {};

        const { tagFilter, tagParams, kqlTagFilter, isCustom, matchType, resourceGroups: matchedResourceGroups } =
            await resolveGroupFilters(tenantId, name, meta).catch(e => {
                console.warn("[cost-groups/detail] resolveGroupFilters:", e.message);
                return { tagFilter: "1=0", tagParams: [] as any[], kqlTagFilter: "false", isCustom: false, matchType: null as string | null, resourceGroups: [] as string[] };
            });

        const currentFY = await getCurrentFY(tenantId, budget, tagFilter, tagParams).catch(e => {
            console.warn("[cost-groups/detail] currentFY:", e.message);
            return { actualCostToDateFY: 0, currentMonthActualCost: 0, monthlyBudget: budget, currentMonthForecast: 0, subscriptionBreakdown: [], unattributedSubscriptionCost: 0, subscriptionsCount: 0, resourceGroupsCount: 0 };
        });

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
            getMonthlyCostTrend(tenantId, budget, tagFilter, tagParams).catch(e => { console.warn("[cost-groups/detail] monthlyCost:", e.message); return []; }),
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
                    title: translateAdvisorText(r.shortDescription?.solution, locale, 'solution')
                        || translateAdvisorText(r.shortDescription?.problem, locale, 'problem')
                        || r._category,
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
            isCustom,
            matchType,
            matchTagKey: meta.match_tag_key || null,
            matchTagValue: meta.match_tag_value || null,
            matchRgPattern: meta.match_rg_pattern || null,
            matchedResourceGroups,
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

/**
 * PATCH /api/cost-groups/[name] — edita un Cost Group ya creado por el
 * usuario (description + regla de membresía: matchType/tagKey/tagValue/
 * rgPattern). El nombre no es editable (es la clave usada para joinear
 * contra CostSnapshots/Budgets en todo el resto de la app — renombrar
 * rompería esas referencias).
 *
 * Solo aplica a grupos "custom" (match_type NOT NULL). Los grupos legacy
 * (auto-descubiertos por el tag CostCenter, sin fila propia con regla) no
 * tienen nada editable — devuelve 404 si el grupo no existe como custom.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
    try {
        const { name: rawName } = await params;
        const name = decodeURIComponent(rawName);
        const body = await request.json();
        const { tenantId, description, matchType, tagKey, tagValue, rgPattern } = body;

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        if (matchType !== "tag" && matchType !== "name_pattern") {
            return NextResponse.json({ error: "matchType debe ser 'tag' o 'name_pattern'" }, { status: 400 });
        }
        if (matchType === "tag" && (!tagKey || !String(tagKey).trim() || !tagValue || !String(tagValue).trim())) {
            return NextResponse.json({ error: "tagKey y tagValue son requeridos para matchType='tag'" }, { status: 400 });
        }
        if (matchType === "name_pattern" && (!rgPattern || !String(rgPattern).trim())) {
            return NextResponse.json({ error: "rgPattern es requerido para matchType='name_pattern'" }, { status: 400 });
        }

        // Misma sensibilidad que crear/eliminar un grupo (gobernanza financiera).
        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true, name });
        }

        await requireTenantTier(request, tenantId, "Business");

        const [result]: any = await pool.query(
            `UPDATE CostGroups
                SET description = ?, match_type = ?, match_tag_key = ?, match_tag_value = ?, match_rg_pattern = ?
              WHERE tenant_id = ? AND name = ? AND match_type IS NOT NULL`,
            [
                description ? String(description).trim().slice(0, 1000) : null,
                matchType,
                matchType === "tag" ? String(tagKey).trim().slice(0, 255) : null,
                matchType === "tag" ? String(tagValue).trim().slice(0, 255) : null,
                matchType === "name_pattern" ? String(rgPattern).trim().slice(0, 255) : null,
                tenantId,
                name,
            ]
        );

        if (result.affectedRows === 0) {
            return NextResponse.json(
                { error: `"${name}" no es un Cost Group editable (no existe o es un grupo legacy sin regla propia)` },
                { status: 404 }
            );
        }

        await invalidateCache(...costGroupsCacheKeys(tenantId));

        return NextResponse.json({ success: true, name });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[cost-groups] PATCH error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

/**
 * DELETE /api/cost-groups/[name] — elimina un Cost Group creado por el
 * usuario, junto con sus asignaciones manuales de Resource Group
 * (CostGroupResourceGroups). El budget en `Budgets` (keyed por
 * cost_center_tag_value) NO se toca acá — es una tabla compartida con el
 * resto de la app (alertas, MCP, Power BI) y un Cost Group sin metadata
 * propia sigue funcionando como grupo legacy derivado del tag CostCenter
 * si ese tag sigue existiendo en CostSnapshots.
 *
 * Solo aplica a grupos "custom" (match_type NOT NULL) — un grupo legacy
 * no tiene fila propia que borrar; volvería a aparecer solo en el próximo
 * sync mientras el tag CostCenter siga presente en los costos.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
    try {
        const { name: rawName } = await params;
        const name = decodeURIComponent(rawName);
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        // Misma sensibilidad que crear/editar un grupo (gobernanza financiera).
        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true, name });
        }

        await requireTenantTier(request, tenantId, "Business");

        const [result]: any = await pool.query(
            `DELETE FROM CostGroups WHERE tenant_id = ? AND name = ? AND match_type IS NOT NULL`,
            [tenantId, name]
        );

        if (result.affectedRows === 0) {
            return NextResponse.json(
                { error: `"${name}" no es un Cost Group eliminable (no existe o es un grupo legacy sin regla propia)` },
                { status: 404 }
            );
        }

        await pool.query(
            `DELETE FROM CostGroupResourceGroups WHERE tenant_id = ? AND group_name = ?`,
            [tenantId, name]
        );

        await invalidateCache(...costGroupsCacheKeys(tenantId));

        return NextResponse.json({ success: true, name });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[cost-groups] DELETE error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
