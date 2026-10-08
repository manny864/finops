/**
 * GET /api/governance/shift-left — historial de estimaciones del PR Cost
 * Estimator (MEJ-20).
 *
 * Lee lo que fue dejando POST /api/v1/shift-left/estimate desde CI.
 *
 * Tier Enterprise, igual que las API Keys públicas (`admin/public-api-keys`): sin
 * una clave no hay forma de que exista una sola fila acá, así que gatearlo más
 * abajo mostraría una pantalla vacía sin explicación.
 */
import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantAccess, requireTenantTier } from "@/lib/requestAuth";
import { errorMessage, errorStatus, serverError } from "@/lib/apiErrors";
import { isMockTenant } from "@/lib/mockData";

export const dynamic = "force-dynamic";

const MAX_FILAS = 100;

/** Demo: sin esto la pantalla queda vacía y parece rota, no vacía. */
function datosDemo() {
    const ahora = Date.now();
    const items = [
        { id: 3, repository: "acme/infra-azure", pr_number: 412, author: "lucia", delta_cost_usd: -184.32, current_monthly_cost_usd: 612.5, projected_monthly_cost_usd: 428.18, resources_priced: 9, resources_unpriced: 0, gate_status: "OK", created_at: new Date(ahora - 3600e3).toISOString() },
        { id: 2, repository: "acme/infra-azure", pr_number: 409, author: "martin", delta_cost_usd: 1240.0, current_monthly_cost_usd: 612.5, projected_monthly_cost_usd: 1852.5, resources_priced: 4, resources_unpriced: 1, gate_status: "EXCEEDED", created_at: new Date(ahora - 26 * 3600e3).toISOString() },
        { id: 1, repository: "acme/plataforma", pr_number: 77, author: "sofia", delta_cost_usd: 19.71, current_monthly_cost_usd: 0, projected_monthly_cost_usd: 19.71, resources_priced: 1, resources_unpriced: 0, gate_status: "NOT_EVALUATED", created_at: new Date(ahora - 5 * 24 * 3600e3).toISOString() },
    ];
    const gates = [{ repository: "acme/infra-azure", threshold_usd: 500 }];
    return NextResponse.json({ items, kpis: kpisDe(items), gates, mock: true });
}

function kpisDe(items: any[]) {
    const deltas = items.map((i) => Number(i.delta_cost_usd) || 0);
    return {
        analizados: items.length,
        // Los dos se informan por separado a propósito: netear un PR que ahorra
        // 500 contra otro que agrega 500 daría cero y escondería las dos cosas.
        aumentoDetectado: Number(deltas.filter((d) => d > 0).reduce((a, b) => a + b, 0).toFixed(2)),
        ahorroDetectado: Number(Math.abs(deltas.filter((d) => d < 0).reduce((a, b) => a + b, 0)).toFixed(2)),
        bloqueados: items.filter((i) => i.gate_status === "EXCEEDED").length,
    };
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        if (isMockTenant(tenantId)) return datosDemo();

        await requireTenantAccess(request, tenantId);
        await requireTenantTier(request, tenantId, "Enterprise");

        const [filas] = await pool.query<any[]>(
            `SELECT id, repository, pr_number, author, commit_sha,
                    current_monthly_cost_usd, projected_monthly_cost_usd, delta_cost_usd,
                    resources_priced, resources_unpriced, gate_status, created_at
               FROM IacCostEstimations
              WHERE tenant_id = ?
              ORDER BY created_at DESC
              LIMIT ?`,
            [tenantId, MAX_FILAS]
        );

        // Los umbrales viajan con el historial y no en un fetch aparte: la
        // pantalla pinta las dos cosas juntas y son dos SELECT chicos.
        const [gates] = await pool.query<any[]>(
            `SELECT repository, threshold_usd
               FROM IacBudgetGates
              WHERE tenant_id = ?
              ORDER BY repository`,
            [tenantId]
        );

        const items = Array.isArray(filas) ? filas : [];
        return NextResponse.json({ items, kpis: kpisDe(items), gates: Array.isArray(gates) ? gates : [] });
    } catch (e) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        }
        console.error("[/api/governance/shift-left]", errorMessage(e));
        return serverError(e);
    }
}
