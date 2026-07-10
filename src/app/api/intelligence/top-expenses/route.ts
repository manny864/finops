/**
 * GET /api/intelligence/top-expenses — "TOP Expenses": top 3 por costo
 * (últimos 30 días) en 4 dimensiones: Cost Groups (tag CostCenter),
 * Subscriptions, Resource Groups y Resources.
 *
 * Disponible para todos los tiers (sin gate de plan).
 *
 * "Resources": CostSnapshots no tiene ResourceId poblado para tenants Azure
 * (sólo AWS — ver migración de esa columna), así que la granularidad más
 * fina real disponible sin fabricar datos es (resource_group, service_name).
 * Se etiqueta como "service_name — resource_group" para que quede claro que
 * no es un recurso individual sino la combinación más específica que existe
 * en los datos de costo agregados.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getSubscriptionNameMap, resolveSubscriptionName, isUnattributedSubscriptionId } from "@/lib/azureSubscriptionNames";
import pool from "@/modules/storage/db";

async function getTopN(tenantId: string, column: string, extraSelect: string, groupBy: string, days: number, limit = 3) {
    const [rows]: any = await pool.query(
        `SELECT ${column} AS name, ${extraSelect}
                SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS cost
         FROM CostSnapshots
         WHERE tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         GROUP BY ${groupBy} ORDER BY cost DESC LIMIT ?`,
        [tenantId, days, limit]
    );
    return (rows as any[]).map(r => ({ name: r.name, cost: Number(r.cost) || 0 }));
}

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const days = 30;
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("top_expenses", tenantId));
        }

        const [topCostGroupsRaw, topResourceGroups, topResourcesRaw] = await Promise.all([
            pool.query(
                `SELECT COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(Tags, '$.CostCenter')), 'null'), 'Untagged/Unknown') AS name,
                        SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS cost
                 FROM CostSnapshots
                 WHERE tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                 GROUP BY name ORDER BY cost DESC LIMIT 3`,
                [tenantId, days]
            ).then(([rows]: any) => (rows as any[]).map(r => ({ name: r.name, cost: Number(r.cost) || 0 }))),
            getTopN(tenantId, "resource_group", "", "resource_group", days),
            pool.query(
                `SELECT CONCAT(service_name, ' — ', resource_group) AS name,
                        SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS cost
                 FROM CostSnapshots
                 WHERE tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                 GROUP BY service_name, resource_group ORDER BY cost DESC LIMIT 3`,
                [tenantId, days]
            ).then(([rows]: any) => (rows as any[]).map(r => ({ name: r.name, cost: Number(r.cost) || 0 }))),
        ]);

        // Sin LIMIT acá: hay que separar primero las filas "no atribuidas"
        // (subscription_id = 'mg-aggregated'/'default', ver azureSubscriptionNames.ts)
        // antes de quedarnos con el top 3 real, para no perder ranking real
        // por culpa de un placeholder mezclado en el medio.
        const [allSubRows]: any = await pool.query(
            `SELECT subscription_id AS name, SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS cost
             FROM CostSnapshots
             WHERE tenant_id = ? AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
             GROUP BY subscription_id ORDER BY cost DESC`,
            [tenantId, days]
        );
        const allSubs = (allSubRows as any[]).map(r => ({ name: r.name as string, cost: Number(r.cost) || 0 }));
        const unattributedSubscriptionCost = Number(
            allSubs.filter(s => isUnattributedSubscriptionId(s.name)).reduce((sum, s) => sum + s.cost, 0).toFixed(2)
        );
        let topSubscriptions = allSubs.filter(s => !isUnattributedSubscriptionId(s.name)).slice(0, 3);
        try {
            const credential = await getAzureCredential(tenantId);
            const subMap = await getSubscriptionNameMap(tenantId, credential);
            topSubscriptions = topSubscriptions.map(s => ({ ...s, name: resolveSubscriptionName(s.name, subMap) }));
        } catch (e: any) {
            console.warn("[top-expenses] subscriptionNames:", e.message);
        }

        return NextResponse.json({
            success: true,
            mock: false,
            topCostGroups: topCostGroupsRaw,
            topSubscriptions,
            unattributedSubscriptionCost,
            topResourceGroups: topResourceGroups.map(r => ({ name: r.name, cost: r.cost })),
            topResources: topResourcesRaw,
        });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[top-expenses] GET error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
