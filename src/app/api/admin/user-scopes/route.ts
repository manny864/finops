/**
 * MEJ-38 — asignar y quitar el alcance de un usuario.
 *
 * Auth: requireTenantRole(['Admin','Owner']). Asignar un alcance es gobernanza
 * de acceso, el mismo nivel que emitir una clave de API.
 *
 * LO QUE HACE ESTE ENDPOINT NO ES UN FILTRO. La fila que escribe le quita al
 * usuario la posibilidad de ver el tenant completo: las rutas que no saben
 * acotarse dejan de responderle (ver `scopeAwareRoutes.ts`). Por eso el POST
 * devuelve cuántas pantallas le quedan — asignar a ciegas sería asignar sin
 * saber qué se está quitando.
 */
import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole, requireTenantTier } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { listarPerspectivas } from "@/services/perspectivesData.service";
import {
    alcanceDelUsuario, asignarAlcance, listarAlcances, quitarAlcance, rolDelUsuario, ROLES_SIN_ALCANCE,
} from "@/services/userScope.service";
import { PAGINAS_CON_ALCANCE_Y_SUS_RUTAS } from "@/lib/scopeAwareRoutes";

/**
 * Cuántas pantallas de datos le quedan a un usuario acotado, hoy. Antes se
 * contaban RUTAS de API (13), que no son pantallas. Una pantalla que se abre
 * por dos direcciones —la vieja y su pestaña del hub— declara las mismas rutas
 * y se cuenta una vez.
 */
const PANTALLAS_CON_ALCANCE = new Set(
    Object.values(PAGINAS_CON_ALCANCE_Y_SUS_RUTAS).map((rutas) => rutas.join("|")),
).size;

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);
        // Perspectives es Enterprise; un alcance sin Perspectives no significa nada.
        await requireTenantTier(request, tenantId, "Enterprise");
        if (isMockTenant(tenantId)) return NextResponse.json({ success: true, mock: true, scopes: [] });

        return NextResponse.json({
            success: true,
            scopes: await listarAlcances(tenantId),
            // Lo que el panel necesita para advertir antes de asignar.
            screensWhenScoped: PANTALLAS_CON_ALCANCE,
        });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[user-scopes] GET:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const { tenantId, email, perspectiveId, group } = await request.json();
        if (!tenantId || !email || !perspectiveId) {
            return NextResponse.json({ error: "Faltan tenantId, email o perspectiveId" }, { status: 400 });
        }
        const identidad = await requireTenantRole(request, tenantId, ["Admin", "Owner"]);
        await requireTenantTier(request, tenantId, "Enterprise");
        if (isMockTenant(tenantId)) return NextResponse.json({ success: true, mock: true });

        const destino = String(email).trim().toLowerCase();

        // NI ADMIN NI OWNER. Emitir una clave de API --MCP o pública-- exige uno
        // de esos dos roles, y una clave es por TENANT y no por usuario: un
        // Admin acotado se saltearía su propio recorte emitiéndose una. Es la
        // regla que cierra esa puerta, y por eso se comprueba acá y no en la UI.
        const rol = await rolDelUsuario(tenantId, destino);
        if (rol && ROLES_SIN_ALCANCE.includes(rol)) {
            return NextResponse.json({
                error: `Un usuario con rol ${rol} no puede tener alcance: podría emitirse una clave de API, que es por tenant, y saltearlo.`,
            }, { status: 409 });
        }
        if (!rol) {
            return NextResponse.json({ error: "Ese usuario no pertenece al tenant." }, { status: 404 });
        }

        const perspectiva = (await listarPerspectivas(tenantId)).find((p) => p.id === Number(perspectiveId));
        if (!perspectiva) return NextResponse.json({ error: "Perspective no encontrada" }, { status: 404 });

        const grupo = group ? String(group) : null;
        if (grupo && !perspectiva.reglas.some((r) => r.grupo === grupo)) {
            // Un grupo que ninguna regla nombra dejaría al usuario sin nada y sin
            // forma de saber por qué.
            return NextResponse.json({ error: `La Perspective "${perspectiva.name}" no tiene un grupo "${grupo}".` }, { status: 400 });
        }

        await asignarAlcance(tenantId, destino, perspectiva.id, grupo, identidad.email);
        return NextResponse.json({ success: true, screensWhenScoped: PANTALLAS_CON_ALCANCE });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[user-scopes] POST:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        const email = request.nextUrl.searchParams.get("email");
        if (!tenantId || !email) return NextResponse.json({ error: "Faltan tenantId o email" }, { status: 400 });
        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);
        await requireTenantTier(request, tenantId, "Enterprise");
        if (isMockTenant(tenantId)) return NextResponse.json({ success: true, mock: true });

        const destino = email.trim().toLowerCase();
        if (!(await alcanceDelUsuario(tenantId, destino))) {
            return NextResponse.json({ error: "Ese usuario no tiene alcance asignado." }, { status: 404 });
        }
        await quitarAlcance(tenantId, destino);
        return NextResponse.json({ success: true });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[user-scopes] DELETE:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
