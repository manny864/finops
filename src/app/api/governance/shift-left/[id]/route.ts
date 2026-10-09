/**
 * GET /api/governance/shift-left/:id — el desglose por recurso de UNA estimación
 * (MEJ-20): qué se cobra, cuánto, y qué no se pudo tarifar.
 *
 * Va aparte del listado porque `detail_json` pesa: un plan grande tiene decenas de
 * líneas con sus componentes, y la pantalla sólo lo necesita cuando alguien abre
 * una fila.
 *
 * Tier Enterprise y acceso al tenant, igual que el listado. El tenant sale de la
 * sesión y no del id: pedir una estimación ajena devuelve 404, no 403, para no
 * confirmar que existe.
 */
import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantAccess, requireTenantTier } from "@/lib/requestAuth";
import { errorMessage, errorStatus, serverError } from "@/lib/apiErrors";
import { isMockTenant } from "@/lib/mockData";
import { detalleDemo } from "@/lib/shiftLeftDemo";

export const dynamic = "force-dynamic";

const aJson = (v: unknown): unknown => {
    if (typeof v !== "string") return v ?? null;
    try { return JSON.parse(v); } catch { return null; }
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: idCrudo } = await params;
        const id = Number(idCrudo);
        if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Id inválido" }, { status: 400 });

        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        if (isMockTenant(tenantId)) {
            const d = detalleDemo(id);
            return d ? NextResponse.json({ ...d, mock: true }) : NextResponse.json({ error: "No encontrada" }, { status: 404 });
        }

        await requireTenantAccess(request, tenantId);
        await requireTenantTier(request, tenantId, "Enterprise");

        const [filas] = await pool.query<any[]>(
            `SELECT id, repository, pr_number, author, commit_sha,
                    current_monthly_cost_usd, projected_monthly_cost_usd, delta_cost_usd,
                    resources_priced, resources_unpriced, gate_status, detail_json, meta_json, created_at
               FROM IacCostEstimations
              WHERE tenant_id = ? AND id = ?
              LIMIT 1`,
            [tenantId, id]
        );
        const f = filas?.[0];
        if (!f) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

        const { detail_json, meta_json, ...item } = f;
        const lineas = aJson(detail_json);
        return NextResponse.json({
            item: { ...item, meta: aJson(meta_json) },
            lines: Array.isArray(lineas) ? lineas : [],
        });
    } catch (e) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        }
        console.error("[/api/governance/shift-left/:id]", errorMessage(e));
        return serverError(e);
    }
}
