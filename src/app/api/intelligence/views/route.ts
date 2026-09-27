/**
 * GET/POST/DELETE /api/intelligence/views — MEJ-38, vistas guardadas.
 *
 * Es la mitad de COMODIDAD de la mejora, y conviene decir qué NO es: una vista
 * no otorga ni quita acceso. Guarda una combinación de Perspective + grupo +
 * filtros para no volver a armarla a mano. Quien manda sobre lo que se puede
 * ver es `UserScopes`, del lado del servidor, y una vista no lo toca ni puede.
 *
 * Por eso aplicar una vista es sólo escribir los mismos parámetros que el
 * usuario podría poner a mano en la URL (`?perspective=&pgroup=`): si pudiera
 * hacer algo que la URL no puede, sería un permiso disfrazado de comodidad.
 *
 * RBAC: pertenencia al tenant para las personales; Admin/Owner para las
 * compartidas, porque una vista compartida la ve —y la pierde— todo el tenant.
 *
 * Un usuario con alcance asignado no llega acá: la ruta no está en
 * `RUTAS_CON_ALCANCE`, así que el default-deny de MEJ-38 la niega. Es
 * deliberado — su recorte no es una preferencia que pueda guardarse ni
 * cambiarse— y no hizo falta escribir nada.
 */

import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantAccess, requireTenantRole } from "@/lib/requestAuth";
import { listarPerspectivas } from "@/services/perspectivesData.service";

/** Dueño de una vista compartida. Cadena vacía y no NULL: ver la migración. */
const COMPARTIDA = "";

const MAX_NOMBRE = 120;

function correoDe(identidad: { email?: string | null }): string {
    return String(identidad?.email || "").toLowerCase().trim();
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        const identidad = await requireTenantAccess(request, tenantId);
        const yo = correoDe(identidad);

        // Las propias y las compartidas. El criterio 4 de la mejora: una
        // personal la ve sólo su dueño.
        const [filas] = await pool.query<any[]>(
            `SELECT id, name, perspective_id AS perspectiveId, group_name AS groupName,
                    filters_json AS filters, is_default AS isDefault, user_email AS owner,
                    created_by AS createdBy, updated_at AS updatedAt
               FROM SavedViews
              WHERE tenant_id = ? AND user_email IN (?, ?)
              ORDER BY user_email = ? DESC, is_default DESC, name ASC`,
            [tenantId, yo, COMPARTIDA, COMPARTIDA]
        );

        return NextResponse.json({
            success: true,
            views: (filas || []).map((f) => ({
                id: f.id,
                name: f.name,
                perspectiveId: f.perspectiveId ?? null,
                groupName: f.groupName ?? null,
                filters: f.filters ?? null,
                isDefault: Boolean(f.isDefault),
                shared: f.owner === COMPARTIDA,
                createdBy: f.createdBy ?? null,
                // Sólo se puede borrar lo propio; lo compartido exige rol, y el
                // servidor lo revalida igual — esto es para no ofrecer un botón
                // que va a fallar.
                canDelete: f.owner !== COMPARTIDA,
            })),
        });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[intelligence/views] GET error:", e);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const cuerpo = (await request.json().catch(() => ({}))) || {};
        const { tenantId, name, perspectiveId, groupName, filters, shared, isDefault } = cuerpo;
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        const nombre = String(name || "").trim();
        if (!nombre || nombre.length > MAX_NOMBRE) {
            return NextResponse.json(
                { error: `El nombre es obligatorio y no puede pasar de ${MAX_NOMBRE} caracteres` },
                { status: 400 }
            );
        }

        // Guard inline en cada handler, no en un helper: `local/no-unauth-tenant-id`
        // existe justamente para que la autorización se lea acá.
        const identidad = shared
            ? await requireTenantRole(request, tenantId, ["Owner", "Admin"])
            : await requireTenantAccess(request, tenantId);
        const yo = correoDe(identidad);
        const dueño = shared ? COMPARTIDA : yo;

        // Una Perspective de otro tenant no resuelve. Se valida contra las del
        // tenant en vez de confiar en el id que llega.
        let perspectiva: number | null = null;
        if (perspectiveId !== undefined && perspectiveId !== null) {
            const n = Number(perspectiveId);
            if (!Number.isInteger(n)) return NextResponse.json({ error: "perspectiveId inválido" }, { status: 400 });
            const existe = (await listarPerspectivas(tenantId)).some((p) => p.id === n);
            if (!existe) return NextResponse.json({ error: "La Perspective no existe en este tenant" }, { status: 404 });
            perspectiva = n;
        }

        const conexion = await pool.getConnection();
        try {
            await conexion.beginTransaction();

            // "A lo sumo una por defecto" lo garantiza esto, no la base: un
            // UNIQUE común no expresa "a lo sumo una en true", y va en la misma
            // transacción para que no queden dos si algo falla en el medio.
            if (isDefault) {
                await conexion.query(
                    "UPDATE SavedViews SET is_default = 0 WHERE tenant_id = ? AND user_email = ?",
                    [tenantId, dueño]
                );
            }

            await conexion.query(
                `INSERT INTO SavedViews
                     (tenant_id, user_email, name, perspective_id, group_name, filters_json, is_default, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                     perspective_id = VALUES(perspective_id),
                     group_name     = VALUES(group_name),
                     filters_json   = VALUES(filters_json),
                     is_default     = VALUES(is_default)`,
                [
                    tenantId,
                    dueño,
                    nombre,
                    perspectiva,
                    groupName ? String(groupName).slice(0, 120) : null,
                    filters === undefined || filters === null ? null : JSON.stringify(filters),
                    isDefault ? 1 : 0,
                    yo,
                ]
            );

            await conexion.commit();
        } catch (err) {
            await conexion.rollback();
            throw err;
        } finally {
            conexion.release();
        }

        return NextResponse.json({ success: true });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[intelligence/views] POST error:", e);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        const id = Number(request.nextUrl.searchParams.get("id"));
        if (!tenantId || !Number.isInteger(id)) {
            return NextResponse.json({ error: "Faltan tenantId o id" }, { status: 400 });
        }

        // Se mira de quién es ANTES de elegir el guard: borrar una compartida
        // se la saca a todo el tenant.
        const [filas] = await pool.query<any[]>(
            "SELECT user_email AS owner FROM SavedViews WHERE id = ? AND tenant_id = ? LIMIT 1",
            [id, tenantId]
        );
        const dueño = filas?.[0]?.owner;
        if (dueño === undefined) {
            // El guard corre igual: sin él, un 404 le confirmaría a cualquiera
            // qué ids existen en un tenant que no es suyo.
            await requireTenantAccess(request, tenantId);
            return NextResponse.json({ error: "No encontrada" }, { status: 404 });
        }

        const identidad =
            dueño === COMPARTIDA
                ? await requireTenantRole(request, tenantId, ["Owner", "Admin"])
                : await requireTenantAccess(request, tenantId);

        if (dueño !== COMPARTIDA && dueño !== correoDe(identidad)) {
            return NextResponse.json({ error: "La vista es de otro usuario" }, { status: 403 });
        }

        await pool.query("DELETE FROM SavedViews WHERE id = ? AND tenant_id = ?", [id, tenantId]);
        return NextResponse.json({ success: true });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[intelligence/views] DELETE error:", e);
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
