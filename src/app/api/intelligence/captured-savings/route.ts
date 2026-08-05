import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { getSnapshotHistory } from "@/services/snapshotService";
import pool from "@/modules/storage/db";

// Detalle de "Ahorro Capturado" (tarjeta `exec` del Dashboard General).
//
// Originalmente leía de `SavingsHistory`, poblada por un POST
// (/api/intelligence/history) que en la práctica nunca tuvo caller (ni cron
// ni trigger de UI) — la tabla estaba 100% vacía para todos los tenants, así
// que esta tarjeta siempre mostraba $0. El historial real de `totalSavings`
// ya existe y se puebla solo: cada hit no-degradado a /api/dashboard/summary
// hace write-through a `DailySnapshots` (domain='dashboard_summary', via
// snapshotService) — la misma fuente que alimenta el gráfico de progreso.
// Reusamos esa tabla en vez de depender de un segundo pipeline muerto.
//
// No existe un campo "wasted" distinto de "potential savings" en el payload
// de dashboard_summary (el motor de zombies calcula un solo número: lo que
// se ahorraría eliminando el desperdicio detectado) — se expone el mismo
// valor en ambos campos hasta que exista una métrica de "gasto actual en
// recursos zombie" genuinamente distinta.

async function getTopSavingsResources(tenantId: string, limit = 10) {
    try {
        const [rows]: any = await pool.query(
            `SELECT resource_id, category, SUM(CAST(metadata LIKE '%"annualSavingsAmount":%' AS UNSIGNED)) AS estimated_savings
             FROM RecommendationActions
             WHERE tenant_id = ? AND status = 'open' AND resource_id IS NOT NULL AND resource_id != ''
             GROUP BY resource_id, category
             ORDER BY estimated_savings DESC LIMIT ?`,
            [tenantId, limit]
        );
        return (rows || []).map((r: any) => ({
            resourceId: r.resource_id,
            category: r.category || 'Unknown',
            estimatedSavings: Number(r.estimated_savings) || 0,
        }));
    } catch (e) {
        console.warn("[captured-savings] topSavingsResources error:", (e as any)?.message);
        return [];
    }
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantRole(request, tenantId, ["Admin", "Owner", "Reader", "Colaborador"]);

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("captured_savings", tenantId));
        }

        const payload = await getWithStaleWhileRevalidate(`captured-savings:v2:${tenantId}`, async () => {
            const twelveMonthsAgo = new Date();
            twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
            const points = await getSnapshotHistory(
                tenantId,
                "dashboard_summary",
                twelveMonthsAgo.toISOString().slice(0, 10),
                undefined,
                "All",
            );

            const history = points.map(p => {
                const savings = Number((p.payload as any)?.totalSavings) || 0;
                return {
                    date: p.date,
                    totalWasted: savings,
                    potentialSavings: savings,
                };
            });

            const latest = history[history.length - 1] || null;
            const previous = history.length > 1 ? history[history.length - 2] : null;
            const changePct = previous && previous.potentialSavings > 0
                ? Number((((latest!.potentialSavings - previous.potentialSavings) / previous.potentialSavings) * 100).toFixed(1))
                : 0;

            const topResources = await getTopSavingsResources(tenantId, 10);

            return {
                success: true,
                history,
                current: latest ? { potentialSavings: latest.potentialSavings, totalWasted: latest.totalWasted, date: latest.date } : null,
                changePct,
                topResources,
            };
        }, 3600);

        return NextResponse.json(payload);
    } catch (err: unknown) {
        if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
        console.error("[captured-savings] GET error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
