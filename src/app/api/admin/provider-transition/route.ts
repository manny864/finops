import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireTenantAccess, requireTenantRole } from "@/lib/requestAuth";
import { serverError } from "@/lib/apiErrors";
import { daysUntil, isCloudProviderId } from "@/lib/providerPolicy";
import { electRetainedProvider, getTenantProviderState } from "@/services/providerLifecycleService";

/**
 * Estado y control de la ventana de gracia del proveedor archivado tras un
 * downgrade de Enterprise con `provider = 'both'`.
 *
 * GET  — estado de la transicion abierta (que proveedor quedo archivado,
 *        cuantos dias faltan para la purga, si todavia se puede exportar).
 *        RBAC minimo: `requireTenantAccess` — es informacion que cualquier
 *        miembro del tenant necesita ver para no perder datos por sorpresa.
 *
 * POST — invierte cual proveedor se retiene y cual queda archivado, durante la
 *        gracia. RBAC minimo: `requireTenantRole(['ADMIN','OWNER'])` — decide
 *        que dataset se va a borrar dentro de N dias; es una decision de
 *        titularidad, no de consulta.
 *
 * Ninguna de las dos operaciones borra nada: la purga la ejecuta unicamente el
 * cron `/api/cron/provider-archive-purge` cuando vence el plazo.
 */
export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "tenantId es requerido" }, { status: 400 });
        }
        await requireTenantAccess(request, tenantId);
        await initializeDatabase();

        const state = await getTenantProviderState(tenantId);
        if (!state) {
            return NextResponse.json({ error: "Tenant no encontrado" }, { status: 404 });
        }

        if (!state.archivedProvider || !state.purgeAt) {
            return NextResponse.json({
                provider: state.provider,
                tier: state.tier,
                archived: null,
            });
        }

        const [rows] = await pool.query(
            `SELECT archived_at, election_source FROM TenantProviderTransitions
              WHERE tenant_id = ? AND status = 'GRACE' ORDER BY id DESC LIMIT 1`,
            [tenantId]
        );
        const transition = (rows as any[])[0] || null;

        return NextResponse.json({
            provider: state.provider,
            tier: state.tier,
            archived: {
                provider: state.archivedProvider,
                retainedProvider: state.provider,
                purgeAt: state.purgeAt.toISOString(),
                daysLeft: Math.max(0, daysUntil(state.purgeAt, new Date())),
                archivedAt: transition?.archived_at ? new Date(transition.archived_at).toISOString() : null,
                electionSource: transition?.election_source ?? null,
                // Durante la gracia los datos archivados siguen siendo
                // exportables aunque el tenant ya no sea Enterprise.
                exportable: true,
            },
        });
    } catch (error: any) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("GET /api/admin/provider-transition error:", error);
        return serverError(error, { message: "Fallo al obtener el estado del proveedor", status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const tenantId = typeof body?.tenantId === "string" ? body.tenantId : null;
        const retained = body?.retained;

        if (!tenantId) {
            return NextResponse.json({ error: "tenantId es requerido" }, { status: 400 });
        }
        if (!isCloudProviderId(retained)) {
            return NextResponse.json({ error: "retained debe ser 'azure' o 'aws'" }, { status: 400 });
        }

        const identity = await requireTenantRole(request, tenantId, ["ADMIN", "OWNER"]);
        await initializeDatabase();

        const result = await electRetainedProvider({
            tenantId,
            retained,
            source: "user",
            actor: identity.email,
        });

        return NextResponse.json({
            success: true,
            changed: result.changed,
            retained: result.retained,
            archived: result.archived,
            purgeAt: result.purgeAt.toISOString(),
            daysLeft: Math.max(0, daysUntil(result.purgeAt, new Date())),
        });
    } catch (error: any) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        if (/transición de proveedor abierta/.test(error?.message || "")) {
            return NextResponse.json({ error: error.message }, { status: 409 });
        }
        console.error("POST /api/admin/provider-transition error:", error);
        return serverError(error, { message: "Fallo al cambiar el proveedor retenido", status: 500 });
    }
}
