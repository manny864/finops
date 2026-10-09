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
import { CENTROS_DEMO, GATES_DEMO, itemsDemo } from "@/lib/shiftLeftDemo";

export const dynamic = "force-dynamic";

const MAX_FILAS = 100;

/** Demo: sin esto la pantalla queda vacía y parece rota, no vacía. */
function datosDemo() {
    const items = itemsDemo();
    return NextResponse.json({
        items, kpis: kpisDe(items), gates: GATES_DEMO, costCenters: CENTROS_DEMO,
        pricing: { discount_pct: 0 }, mock: true,
    });
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
                    resources_priced, resources_unpriced, gate_status, meta_json, created_at
               FROM IacCostEstimations
              WHERE tenant_id = ?
              ORDER BY created_at DESC
              LIMIT ?`,
            [tenantId, MAX_FILAS]
        );

        // Lo que no depende de la lista viaja con ella y no en fetches aparte: la
        // pantalla pinta todo junto y son SELECT chicos.
        const [gates] = await pool.query<any[]>(
            `SELECT repository, cost_center_name, threshold_usd, threshold_pct_of_remaining
               FROM IacBudgetGates
              WHERE tenant_id = ?
              ORDER BY repository`,
            [tenantId]
        );
        const [centros] = await pool.query<any[]>(
            `SELECT cost_center_name, monthly_budget_usd
               FROM CostCenterBudgets
              WHERE tenant_id = ?
              ORDER BY cost_center_name`,
            [tenantId]
        );
        const [precios] = await pool.query<any[]>(
            `SELECT discount_pct FROM IacPricingSettings WHERE tenant_id = ? LIMIT 1`,
            [tenantId]
        );

        // `meta_json` es JSON nativo de MySQL: mysql2 lo entrega ya parseado, pero un
        // driver o una versión distinta puede devolver el texto.
        const items = (Array.isArray(filas) ? filas : []).map(({ meta_json, ...f }) => {
            let meta: unknown = meta_json ?? null;
            if (typeof meta === "string") {
                try { meta = JSON.parse(meta); } catch { meta = null; }
            }
            return { ...f, meta };
        });

        return NextResponse.json({
            items,
            kpis: kpisDe(items),
            gates: Array.isArray(gates) ? gates : [],
            costCenters: Array.isArray(centros) ? centros : [],
            pricing: { discount_pct: Number(precios?.[0]?.discount_pct) || 0 },
        });
    } catch (e) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        }
        console.error("[/api/governance/shift-left]", errorMessage(e));
        return serverError(e);
    }
}
