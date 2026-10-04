import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantRole, requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isValidTimeZone, DEFAULT_TIMEZONE } from "@/lib/timezone";
import { mesFiscalValido } from "@/lib/fiscalYear";
import { invalidateCache, invalidateCachePattern, costGroupsCacheKeys } from "@/lib/cache";
import { costCentersCacheKey, whiteboardCachePrefix } from "@/lib/cacheKeys";

/**
 * Preferencias del tenant que gobiernan cómo se presenta la información.
 *
 * Nace con `timezone` porque el wizard de onboarding ya pedía la zona horaria
 * y no tenía dónde guardarla: el `<select>` existía desde siempre y su valor se
 * descartaba al terminar el wizard (no había columna ni endpoint).
 *
 * `currency` está en la misma situación y todavía no se resolvió — ver
 * infra/docs/pendientes-de-app.md.
 *
 * MEJ-36 suma `fiscalYearStartMonth` acá y no en una ruta propia: es otra
 * preferencia que gobierna cómo se presenta la información, y gobierna lo mismo
 * que la zona horaria — dónde se corta un período.
 */

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        }
        await requireTenantAccess(request, tenantId);

        const [rows] = await pool.query<any[]>(
            "SELECT timezone, fiscal_year_start_month FROM Tenants WHERE tenant_id = ?",
            [tenantId]
        );
        return NextResponse.json({
            timezone: rows?.[0]?.timezone || DEFAULT_TIMEZONE,
            fiscalYearStartMonth: mesFiscalValido(rows?.[0]?.fiscal_year_start_month),
        });
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
        const { tenantId, timezone, fiscalYearStartMonth } = (await request.json()) || {};
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el parámetro tenantId" }, { status: 400 });
        }
        if (timezone === undefined && fiscalYearStartMonth === undefined) {
            return NextResponse.json({ error: "No se envió ninguna preferencia a cambiar" }, { status: 400 });
        }

        // Se valida contra la base de zonas de Intl, no contra una lista propia:
        // una zona inventada dejaría los horarios de Power Schedules cayendo en
        // silencio al offset fijo, que es justamente el bug que esto resuelve.
        if (timezone !== undefined && !isValidTimeZone(timezone)) {
            return NextResponse.json(
                { error: "Zona horaria inválida (se espera un nombre IANA, ej. America/Argentina/Buenos_Aires)" },
                { status: 400 }
            );
        }

        // MEJ-36: se rechaza un mes fuera de rango en vez de caer a enero en
        // silencio. Acá hay alguien eligiendo, y elegir mal tiene que doler:
        // guardar enero cuando pidió abril le corre TODOS los acumulados
        // anuales sin decírselo, que es el bug que esta mejora arregla.
        if (fiscalYearStartMonth !== undefined) {
            const n = Number(fiscalYearStartMonth);
            if (!Number.isInteger(n) || n < 1 || n > 12) {
                return NextResponse.json(
                    { error: "fiscalYearStartMonth debe ser un entero entre 1 y 12" },
                    { status: 400 }
                );
            }
        }

        // Cambiar la zona mueve la hora a la que se apagan las VMs de todo el
        // tenant, y cambiar el ejercicio mueve todos los acumulados anuales:
        // ninguna de las dos alcanza con ser miembro.
        await requireTenantRole(request, tenantId, ["Owner", "Admin"]);

        const sets: string[] = [];
        const valores: unknown[] = [];
        if (timezone !== undefined) { sets.push("timezone = ?"); valores.push(timezone); }
        if (fiscalYearStartMonth !== undefined) {
            sets.push("fiscal_year_start_month = ?");
            valores.push(Number(fiscalYearStartMonth));
        }
        await pool.query(`UPDATE Tenants SET ${sets.join(", ")} WHERE tenant_id = ?`, [...valores, tenantId]);

        // El ejercicio corta los acumulados de tres tableros cacheados —el
        // Whiteboard, hasta 12 h—. Sin esto el cambio no se ve hasta que vencen
        // y parece que no se guardó.
        if (fiscalYearStartMonth !== undefined) {
            await invalidateCache(...costGroupsCacheKeys(tenantId), costCentersCacheKey(tenantId));
            await invalidateCachePattern(`${whiteboardCachePrefix(tenantId)}:*`);
        }

        return NextResponse.json({ success: true, timezone, fiscalYearStartMonth });
    } catch (e) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        console.error("admin/tenant-settings PUT error:", e);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
