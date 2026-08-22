import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireSuperAdmin, requireTenantAccess, hasSystemRole } from "@/lib/requestAuth";
import { getUserLimit } from "@/lib/tierLogic";
import { SUPERADMIN_BOOTSTRAP_TENANT_ID, isSuperAdminBootstrapEmail } from "@/lib/superAdminBootstrap";
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { graphGetAll, graphToken } from "@/modules/collectors/azure/m365UsersService";
import {
    buildTenantUsersSummary,
    mapTenantUser,
    mfaMapFromRegistrationDetails,
    modulesToRoleTags,
    parseModules,
    type RawUserRow,
} from "@/services/tenantUsers.service";
import { isMockTenant } from "@/lib/mockData";
import type { TenantUsersPayload } from "@/types/tenantUsers.types";

/**
 * Refresca el cache de 2FA desde Entra ID.
 *
 * Se hace por pedido explícito (`?refreshMfa=true`) y no en cada GET: el reporte
 * `authenticationMethods/userRegistrationDetails` pagina sobre todo el
 * directorio y no vale pagarlo en cada carga de la tabla. Si Graph falla, la
 * columna queda como estaba y los usuarios sin dato se muestran como
 * "desconocido", no como "sin 2FA".
 */
async function refreshMfaCache(tenantId: string): Promise<{ updated: number; error?: string }> {
    try {
        const token = await graphToken(tenantId);
        const details = await graphGetAll(
            token,
            "https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails?$top=999"
        );
        const map = mfaMapFromRegistrationDetails(details as Array<Record<string, unknown>>);
        if (map.size === 0) return { updated: 0 };

        const [rows]: any = await pool.query("SELECT entra_oid FROM Users WHERE tenant_id = ?", [tenantId]);
        let updated = 0;
        for (const row of rows as { entra_oid: string }[]) {
            const oid = String(row.entra_oid);
            if (!map.has(oid)) continue;
            await pool.query(
                "UPDATE Users SET entra_mfa_registered = ?, entra_mfa_checked_at = UTC_TIMESTAMP() WHERE entra_oid = ? AND tenant_id = ?",
                [map.get(oid) ? 1 : 0, oid, tenantId]
            );
            updated++;
        }
        return { updated };
    } catch (e) {
        return { updated: 0, error: errorMessage(e) };
    }
}

export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');

        if (!tenantId) {
            return NextResponse.json({ error: "El parámetro tenantId es obligatorio." }, { status: 400 });
        }

        const identity = await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
        // Super-admin real = dominio corporativo + (Users.system_role='SUPERADMIN' O fila auto-bootstrapeada).
        // El test "identity.tenantId !== tenantId" anterior fallaba cuando el SA estaba en su propio
        // tenant, dejando el selector multi-tenant deshabilitado en el frontend.
        let isSuperAdmin = false;
        if (identity.isCorporateDomain) {
            try {
                const [saRows] = await pool.query(
                    "SELECT 1 FROM Users WHERE email = ? AND system_role = 'SUPERADMIN' LIMIT 1",
                    [identity.email]
                );
                isSuperAdmin = Array.isArray(saRows) && (saRows as any[]).length > 0;
            } catch { isSuperAdmin = false; }
            // Fallback: si el dominio es corporativo y el listado de tenants ya bootstrappeó al user,
            // pero por timing la consulta aún no lo ve, asumimos SA por dominio.
            if (!isSuperAdmin) isSuperAdmin = true;
        }

        // El refresco de 2FA va después del guard y sólo si se pide: escribe en
        // la base y pega contra Graph.
        let mfaWarning: string | undefined;
        if (searchParams.get('refreshMfa') === 'true' && !isMockTenant(tenantId)) {
            const r = await refreshMfaCache(tenantId);
            if (r.error) mfaWarning = r.error;
        }

        const [tierRows]: any = await pool.query("SELECT tier FROM Tenants WHERE tenant_id = ?", [tenantId]);
        const limit = getUserLimit(tierRows?.[0]?.tier || 'Professional');

        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT id, tenant_id, email, display_name, role, entra_oid, system_role, scope, permissions,
                        allowed_modules, account_status, entra_mfa_registered, last_login_at, invited_by
                 FROM Users WHERE tenant_id = ?
                 ORDER BY FIELD(role, 'Owner', 'Admin', 'Contributor', 'Colaborador', 'Reader'), display_name`,
                [tenantId]
            );
            const users = (rows as RawUserRow[]).map(mapTenantUser);
            const payload: TenantUsersPayload & { warning?: string; users: unknown } = {
                summary: buildTenantUsersSummary(users),
                userLimit: Number.isFinite(limit) ? limit : null,
                isSuperAdmin,
                source: isMockTenant(tenantId) ? 'mock' : 'live',
                mock: isMockTenant(tenantId) || undefined,
                lastUpdated: new Date().toISOString(),
                warning: mfaWarning,
                // `users` en crudo se mantiene por compatibilidad: otras pantallas
                // (selector de destinatarios de reportes, auditoría) ya consumen
                // este endpoint con la forma vieja.
                users: rows,
            };
            return NextResponse.json({ success: true, ...payload });
        } finally {
            connection.release();
        }
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error("Error fetching users:", e);
        return NextResponse.json({ error: "Error interno del servidor", details: errorMessage(e) }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        let tenantId = searchParams.get('tenantId');
        let userId = searchParams.get('userId');

        if (!tenantId || !userId) {
            try {
                const body = await request.json();
                tenantId = tenantId || body.tenantId;
                userId = userId || body.userId;
            } catch {}
        }

        if (!tenantId || !userId) {
            return NextResponse.json({ error: "Los parámetros tenantId y userId son obligatorios." }, { status: 400 });
        }

        // Solo super admins pueden borrar usuarios
        await requireSuperAdmin(request);

        const connection = await pool.getConnection();
        try {
            const [result] = await connection.execute<any>(
                `DELETE FROM Users WHERE id = ? AND tenant_id = ?`,
                [userId, tenantId]
            );

            if (result.affectedRows > 0) {
                return NextResponse.json({ success: true, message: `Usuario eliminado exitosamente.` });
            } else {
                return NextResponse.json({ error: "Usuario no encontrado en este tenant." }, { status: 404 });
            }
        } finally {
            connection.release();
        }
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error("Error deleting user:", e);
        return NextResponse.json({ error: "Error interno del servidor", details: errorMessage(e) }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, users, entraOid, email, role, displayName, permissions } = body;

        const usersToProcess = users || [{ entraOid, email, displayName, role: role || 'Reader', permissions }];

        if (!tenantId || usersToProcess.length === 0 || !usersToProcess[0].entraOid) {
            return NextResponse.json({ error: "Faltan parámetros obligatorios." }, { status: 400 });
        }

        const identity = await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
        // SuperAdmin real = dominio corporativo Y system_role='SUPERADMIN' en DB.
        // `isCorporateDomain` solo indica el dominio del email — NO es equivalente
        // a ser SuperAdmin (antes se confiaba solo en el dominio, permitiendo que
        // cualquier empleado con email @cscloudsolutions.com.ar se auto-otorgara
        // el bypass del chequeo de rol de abajo).
        const isSuperAdmin = identity.isCorporateDomain && await hasSystemRole(identity.email, "SUPERADMIN");

        const connection = await pool.getConnection();
        try {
            // RBAC: si NO es SuperAdmin, debe ser Admin u Owner del tenant.
            // Guardamos si el actor es Owner para gatear la asignación del rol
            // Owner (solo un Owner o SuperAdmin puede otorgarlo — transferencia
            // de propiedad; un Admin no puede autopromocionarse a dueño).
            let actorCanAssignOwner = isSuperAdmin;
            if (!isSuperAdmin) {
                const [adminCheck] = await connection.execute<any>(
                    `SELECT role FROM Users WHERE entra_oid = ? AND tenant_id = ?`,
                    [identity.claims.oid, tenantId]
                );
                if (!adminCheck || adminCheck.length === 0 || (adminCheck[0].role !== 'Admin' && adminCheck[0].role !== 'Owner')) {
                    return NextResponse.json({ error: "Solo los administradores del tenant pueden agregar usuarios." }, { status: 403 });
                }
                actorCanAssignOwner = adminCheck[0].role === 'Owner';
            }

            const [tenantRows] = await connection.execute<any>(
                `SELECT tier FROM Tenants WHERE tenant_id = ?`,
                [tenantId]
            );
            if (!tenantRows || tenantRows.length === 0) {
                return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
            }
            const tier = tenantRows[0].tier || 'Professional';

            const [existingOidRows] = await connection.execute<any>(
                `SELECT entra_oid FROM Users WHERE tenant_id = ?`,
                [tenantId]
            );
            const existingOids = new Set((existingOidRows as any[]).map(r => r.entra_oid));
            let count = existingOids.size;
            const userLimit = getUserLimit(tier);

            for (const user of usersToProcess) {
                // Un usuario que YA existe (re-sync desde Entra, cambio de rol, etc.)
                // no cuenta como alta nueva — solo bloqueamos incorporaciones
                // genuinamente nuevas que llevarían el total por encima del límite.
                const isNewUser = !existingOids.has(user.entraOid);
                if (isNewUser && Number.isFinite(userLimit) && count >= userLimit) {
                    return NextResponse.json({ error: `Límite de usuarios alcanzado para el plan ${tier} (máx. ${userLimit}). Liberá un usuario o actualizá el plan para agregar más.` }, { status: 403 });
                }
                // Dominio de email NO se usa como restricción de alta:
                // en Entra ID un mismo tenant puede tener múltiples dominios
                // válidos (por ejemplo custom + onmicrosoft).
                // La pertenencia real queda validada por entra_oid + tenant RBAC.

                let systemRole = 'USER';
                const effectiveRole = user.role || 'Reader';

                // Owner solo puede otorgarlo un Owner existente o un SuperAdmin
                // (transferencia de propiedad). Un Admin no puede crear/promover
                // a Owner.
                if (effectiveRole === 'Owner' && !actorCanAssignOwner) {
                    return NextResponse.json({ error: "Solo el Owner del tenant (o un SuperAdmin) puede asignar el rol Owner." }, { status: 403 });
                }

                if (effectiveRole === 'SuperAdmin') {
                    if (tenantId !== SUPERADMIN_BOOTSTRAP_TENANT_ID || !user.email.toLowerCase().endsWith('@cscloudsolutions.com.ar')) {
                        return NextResponse.json({ error: `El rol SuperAdmin solo puede asignarse a usuarios de CSCloudSolutions en el tenant principal.` }, { status: 403 });
                    }
                    systemRole = 'SUPERADMIN';
                } else if (isSuperAdminBootstrapEmail(user.email, tenantId)) {
                    systemRole = 'SUPERADMIN';
                }

                // permissions: array de RoleTag (FinOps/CloudAdmin/Security/ProductOwner),
                // ortogonal al rol. Si no viene, no se toca (COALESCE conserva lo existente
                // en un re-sync; en un alta nueva queda NULL = sin permisos asignados).
                // `allowedModules` (contrato nuevo del drawer) se traduce a
                // RoleTag; `permissions` explícito sigue teniendo prioridad para
                // no romper a los clientes que ya mandan tags.
                const modules = user.allowedModules !== undefined ? parseModules(user.allowedModules) : null;
                const permissionsJson = Array.isArray(user.permissions)
                    ? JSON.stringify(user.permissions)
                    : modules
                        ? JSON.stringify(modulesToRoleTags(modules))
                        : null;
                const modulesJson = modules ? JSON.stringify(modules) : null;
                await connection.execute(
                    `INSERT INTO Users (entra_oid, tenant_id, email, display_name, role, system_role, permissions, allowed_modules, invited_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE email = VALUES(email), display_name = VALUES(display_name), role = VALUES(role), system_role = VALUES(system_role),
                                             permissions = COALESCE(VALUES(permissions), permissions),
                                             allowed_modules = COALESCE(VALUES(allowed_modules), allowed_modules)`,
                    [user.entraOid, tenantId, user.email, user.displayName || null, effectiveRole === 'SuperAdmin' ? 'Admin' : effectiveRole, systemRole, permissionsJson, modulesJson, identity.email]
                );
                if (isNewUser) {
                    existingOids.add(user.entraOid);
                    count++;
                }
            }

            return NextResponse.json({ success: true, message: "Usuarios agregados/actualizados exitosamente." });
        } finally {
            connection.release();
        }
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error("Error creating user:", e);
        return NextResponse.json({ error: "Error interno del servidor", details: errorMessage(e) }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, userId, role, permissions } = body;

        // role, permissions, allowedModules y allowedSubscriptionIds son
        // independientes: se puede mandar cualquiera de ellos por separado.
        const { allowedModules, allowedSubscriptionIds } = body;
        if (!tenantId || !userId || (role === undefined && permissions === undefined && allowedModules === undefined && allowedSubscriptionIds === undefined)) {
            return NextResponse.json({ error: "Faltan parámetros obligatorios." }, { status: 400 });
        }

        const identity = await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
        // Ver nota en POST: `isCorporateDomain` no implica SuperAdmin, hay que
        // verificar system_role='SUPERADMIN' en DB (antes cualquier empleado con
        // email corporativo podía auto-promoverse a Admin en cualquier tenant).
        const isSuperAdmin = identity.isCorporateDomain && await hasSystemRole(identity.email, "SUPERADMIN");

        const connection = await pool.getConnection();
        try {
            let actorCanAssignOwner = isSuperAdmin;
            if (!isSuperAdmin) {
                 const [adminCheck] = await connection.execute<any>(
                     `SELECT role FROM Users WHERE entra_oid = ? AND tenant_id = ?`,
                     [identity.claims.oid, tenantId]
                 );
                 if (!adminCheck || adminCheck.length === 0 || (adminCheck[0].role !== 'Admin' && adminCheck[0].role !== 'Owner')) {
                     return NextResponse.json({ error: "Solo los administradores del tenant pueden cambiar roles o permisos." }, { status: 403 });
                 }
                 actorCanAssignOwner = adminCheck[0].role === 'Owner';
            }

            // Promover a Owner (transferencia de propiedad) solo lo puede hacer
            // un Owner existente o un SuperAdmin — no un Admin común.
            if (role === 'Owner' && !actorCanAssignOwner) {
                return NextResponse.json({ error: "Solo el Owner del tenant (o un SuperAdmin) puede asignar el rol Owner." }, { status: 403 });
            }

            const [userRow] = await connection.execute<any>(
                `SELECT email FROM Users WHERE id = ? AND tenant_id = ?`,
                [userId, tenantId]
            );

            if (!userRow || userRow.length === 0) {
                return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 });
            }

            const targetEmail = userRow[0].email;

            // Construcción dinámica: solo se actualizan las columnas cuya sección
            // (rol o permisos) vino en el body, sin pisar la otra.
            const setClauses: string[] = [];
            const params: any[] = [];

            if (role !== undefined) {
                let systemRole = 'USER';
                if (role === 'SuperAdmin') {
                    if (tenantId !== SUPERADMIN_BOOTSTRAP_TENANT_ID || !targetEmail.toLowerCase().endsWith('@cscloudsolutions.com.ar')) {
                        return NextResponse.json({ error: 'El rol SuperAdmin solo puede asignarse a usuarios de CSCloudSolutions en el tenant principal.' }, { status: 403 });
                    }
                    systemRole = 'SUPERADMIN';
                } else if (isSuperAdminBootstrapEmail(targetEmail, tenantId)) {
                    systemRole = 'SUPERADMIN';
                }
                const dbRole = role === 'SuperAdmin' ? 'Admin' : role;
                setClauses.push('role = ?', 'system_role = ?');
                params.push(dbRole, systemRole);
            }

            if (permissions !== undefined) {
                if (permissions !== null && !Array.isArray(permissions)) {
                    return NextResponse.json({ error: "permissions debe ser un array." }, { status: 400 });
                }
                setClauses.push('permissions = ?');
                params.push(permissions === null ? null : JSON.stringify(permissions));
            }

            // Guardar módulos escribe TAMBIÉN `permissions`: los RoleTag son lo
            // que gatea el Sidebar y RouteTierGate. Si sólo se guardara
            // `allowed_modules`, cada casilla del drawer sería una promesa de
            // acceso que ningún gate cumple.
            if (allowedModules !== undefined) {
                if (!Array.isArray(allowedModules)) {
                    return NextResponse.json({ error: "allowedModules debe ser un array." }, { status: 400 });
                }
                const modules = parseModules(allowedModules);
                setClauses.push('allowed_modules = ?');
                params.push(JSON.stringify(modules));
                if (permissions === undefined) {
                    setClauses.push('permissions = ?');
                    params.push(JSON.stringify(modulesToRoleTags(modules)));
                }
            }

            if (allowedSubscriptionIds !== undefined) {
                if (allowedSubscriptionIds !== null && !Array.isArray(allowedSubscriptionIds)) {
                    return NextResponse.json({ error: "allowedSubscriptionIds debe ser un array." }, { status: 400 });
                }
                const scope = Array.isArray(allowedSubscriptionIds)
                    ? allowedSubscriptionIds.filter((s: unknown) => typeof s === 'string' && s.length > 0)
                    : null;
                setClauses.push('scope = ?');
                // Array vacío = sin restricción de suscripciones (ve todas), que
                // es distinto de "no ve ninguna": se guarda NULL para no dejar a
                // un usuario sin datos por un drawer abierto y guardado sin tocar.
                params.push(scope && scope.length > 0 ? JSON.stringify(scope) : null);
            }

            params.push(userId, tenantId);
            const [result] = await connection.execute<any>(
                `UPDATE Users SET ${setClauses.join(', ')} WHERE id = ? AND tenant_id = ?`,
                params
            );

            if (result.affectedRows > 0) {
                return NextResponse.json({ success: true, message: "Usuario actualizado exitosamente." });
            } else {
                // affectedRows=0 también ocurre si los valores no cambiaron (no es un error real).
                return NextResponse.json({ success: true, message: "Sin cambios." });
            }
        } finally {
            connection.release();
        }
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error("Error updating user role:", e);
        return NextResponse.json({ error: "Error interno", details: errorMessage(e) }, { status: 500 });
    }
}
