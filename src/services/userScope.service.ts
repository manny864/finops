/**
 * MEJ-38 — el alcance de Perspective como PERMISO.
 *
 * La diferencia con el selector transversal de MEJ-34 no es técnica sino de
 * quién manda: aquél sale de la URL y lo elige el usuario, y una pantalla que
 * no puede acotar muestra todo y lo dice. Esto sale de `UserScopes`, no lo
 * elige nadie, y una pantalla que no puede acotar **niega**.
 *
 * Sin fila, nada cambia. Es lo que hace que desplegarlo no toque a nadie.
 */

import pool from "@/modules/storage/db";
import type { RowDataPacket } from "mysql2";

export interface AlcanceAsignado {
    perspectiveId: number;
    /** `null` = cualquier grupo de esa Perspective, que no es lo mismo que no acotar. */
    grupo: string | null;
}

/**
 * Los roles que NO pueden tener alcance, y el motivo es concreto: emitir una
 * clave de API —MCP o pública— exige uno de estos dos, y una clave es por
 * TENANT y no por usuario. Un Admin acotado se saltearía su propio recorte
 * emitiéndose una clave y pegándole a `/api/mcp` o `/api/v1/*`.
 *
 * Comparación en minúsculas porque `Users.role` no es consistente: conviven
 * `Admin` y `ADMIN` en las guardas, y `requireTenantRole` ya compara así.
 */
export const ROLES_SIN_ALCANCE = ["admin", "owner"];

/** El alcance asignado a un usuario, o `null` si no tiene. */
export async function alcanceDelUsuario(tenantId: string, email: string, entraOid?: string): Promise<AlcanceAsignado | null> {
    if (!tenantId || (!email && !entraOid)) return null;
    try {
        const [rows] = await pool.query<RowDataPacket[]>(
            entraOid
                ? `SELECT us.perspective_id, us.group_name FROM UserScopes us
                   WHERE us.tenant_id = ? AND (us.user_email = ? OR EXISTS (
                       SELECT 1 FROM Users u WHERE u.tenant_id = us.tenant_id
                       AND u.email = us.user_email AND u.entra_oid = ?
                   )) LIMIT 2`
                : `SELECT perspective_id, group_name FROM UserScopes
                   WHERE tenant_id = ? AND user_email = ? LIMIT 2`,
            entraOid ? [tenantId, email, entraOid] : [tenantId, email],
        );
        if (rows.length > 1) throw new Error("Asignaciones de alcance ambiguas para la identidad autenticada.");
        const r = rows?.[0];
        if (!r) return null;
        return { perspectiveId: Number(r.perspective_id), grupo: r.group_name ?? null };
    } catch (e) {
        console.warn("[userScope] no se pudo leer el alcance:", e instanceof Error ? e.message : e);
        throw e;
    }
}

/** Los alcances asignados en un tenant, para el panel de administración. */
export async function listarAlcances(tenantId: string) {
    const [rows] = await pool.query<any[]>(
        `SELECT us.user_email, us.perspective_id, us.group_name, us.assigned_by, us.updated_at,
                p.name AS perspective_name, u.role
           FROM UserScopes us
           LEFT JOIN Perspectives p ON p.id = us.perspective_id
           LEFT JOIN Users u ON u.tenant_id = us.tenant_id AND u.email = us.user_email
          WHERE us.tenant_id = ?
          ORDER BY us.user_email`,
        [tenantId],
    );
    return (rows || []).map((r) => ({
        email: r.user_email as string,
        perspectiveId: Number(r.perspective_id),
        perspectiveName: (r.perspective_name as string) ?? null,
        grupo: (r.group_name as string) ?? null,
        asignadoPor: (r.assigned_by as string) ?? null,
        rol: (r.role as string) ?? null,
        actualizado: r.updated_at,
    }));
}

/** El rol de un usuario en el tenant, en minúsculas, o `null` si no está. */
export async function rolDelUsuario(tenantId: string, email: string): Promise<string | null> {
    const [rows] = await pool.query<any[]>(
        `SELECT role FROM Users WHERE tenant_id = ? AND email = ? LIMIT 1`,
        [tenantId, email],
    );
    const rol = rows?.[0]?.role;
    return rol ? String(rol).toLowerCase() : null;
}

/** Asigna o reemplaza el alcance de un usuario. Una fila por usuario (ver la migración). */
export async function asignarAlcance(
    tenantId: string, email: string, perspectiveId: number, grupo: string | null, asignadoPor: string,
): Promise<void> {
    await pool.query(
        `INSERT INTO UserScopes (tenant_id, user_email, perspective_id, group_name, assigned_by)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE perspective_id = VALUES(perspective_id),
                                 group_name = VALUES(group_name),
                                 assigned_by = VALUES(assigned_by)`,
        [tenantId, email, perspectiveId, grupo, asignadoPor],
    );
}

/** Le devuelve a un usuario la vista completa del tenant. */
export async function quitarAlcance(tenantId: string, email: string): Promise<void> {
    await pool.query(`DELETE FROM UserScopes WHERE tenant_id = ? AND user_email = ?`, [tenantId, email]);
}
