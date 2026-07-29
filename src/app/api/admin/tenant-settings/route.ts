import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantRole, requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isValidTimeZone, DEFAULT_TIMEZONE } from "@/lib/timezone";

/**
 * Preferencias del tenant que gobiernan cómo se presenta la información.
 *
 * Nace con `timezone` porque el wizard de onboarding ya pedía la zona horaria
 * y no tenía dónde guardarla: el `<select>` existía desde siempre y su valor se
 * descartaba al terminar el wizard (no había columna ni endpoint).
 *
 * `currency` está en la misma situación y todavía no se resolvió — ver
 * infra/docs/pendientes-de-app.md.
 */

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        }
        await requireTenantAccess(request, tenantId);

        const [rows] = await pool.query<any[]>(
            "SELECT timezone FROM Tenants WHERE tenant_id = ?",
            [tenantId]
        );
        return NextResponse.json({ timezone: rows?.[0]?.timezone || DEFAULT_TIMEZONE });
    } catch (e) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        console.error("admin/tenant-settings GET error:", e);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const { tenantId, timezone } = (await request.json()) || {};
        if (!tenantId || !timezone) {
            return NextResponse.json({ error: "Faltan parámetros tenantId o timezone" }, { status: 400 });
        }

        // Se valida contra la base de zonas de Intl, no contra una lista propia:
        // una zona inventada dejaría los horarios de Power Schedules cayendo en
        // silencio al offset fijo, que es justamente el bug que esto resuelve.
        if (!isValidTimeZone(timezone)) {
            return NextResponse.json(
                { error: "Zona horaria inválida (se espera un nombre IANA, ej. America/Argentina/Buenos_Aires)" },
                { status: 400 }
            );
        }

        // Cambiar la zona mueve la hora a la que se apagan las VMs de todo el
        // tenant, así que no alcanza con ser miembro.
        await requireTenantRole(request, tenantId, ["Owner", "Admin"]);

        await pool.query("UPDATE Tenants SET timezone = ? WHERE tenant_id = ?", [timezone, tenantId]);

        return NextResponse.json({ success: true, timezone });
    } catch (e) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        console.error("admin/tenant-settings PUT error:", e);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
