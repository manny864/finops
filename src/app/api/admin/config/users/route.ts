import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireRequestIdentity, requireSuperAdmin, requireTenantAccess, hasSystemRole } from "@/lib/requestAuth";
import { getUserLimit } from "@/lib/tierLogic";
import { SUPERADMIN_BOOTSTRAP_TENANT_ID, isSuperAdminBootstrapEmail } from "@/lib/superAdminBootstrap";

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

        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT id, email, display_name, role, entra_oid, system_role, scope, permissions FROM Users WHERE tenant_id = ?`,
                [tenantId]
            );
            return NextResponse.json({ success: true, users: rows, isSuperAdmin });
        } finally {
            connection.release();
        }
    } catch (e: any) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("Error fetching users:", e);
        return NextResponse.json({ error: "Error interno del servidor", details: e.message }, { status: 500 });
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
            } catch (e) {}
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
    } catch (e: any) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("Error deleting user:", e);
        return NextResponse.json({ error: "Error interno del servidor", details: e.message }, { status: 500 });
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
        const currentAdminEmail = identity.email;
        // SuperAdmin real = dominio corporativo Y system_role='SUPERADMIN' en DB.
        // `isCorporateDomain` solo indica el dominio del email — NO es equivalente
        // a ser SuperAdmin (antes se confiaba solo en el dominio, permitiendo que
        // cualquier empleado con email @cscloudsolutions.com.ar se auto-otorgara
        // el bypass del chequeo de rol de abajo).
        const isSuperAdmin = identity.isCorporateDomain && await hasSystemRole(identity.email, "SUPERADMIN");

        const connection = await pool.getConnection();
        try {
            // RBAC: si NO es SuperAdmin, debe ser Admin del tenant.
            if (!isSuperAdmin) {
                const [adminCheck] = await connection.execute<any>(
                    `SELECT role FROM Users WHERE entra_oid = ? AND tenant_id = ?`,
                    [identity.claims.oid, tenantId]
                );
                if (!adminCheck || adminCheck.length === 0 || adminCheck[0].role !== 'Admin') {
                    return NextResponse.json({ error: "Solo los administradores del tenant pueden agregar usuarios." }, { status: 403 });
                }
            }

            const [tenantRows] = await connection.execute<any>(
                `SELECT tier FROM Tenants WHERE tenant_id = ?`,
                [tenantId]
            );
            if (!tenantRows || tenantRows.length === 0) {
                return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
            }
            const tier = tenantRows[0].tier || 'Essential';

            const [existingOidRows] = await connection.execute<any>(
                `SELECT entra_oid FROM Users WHERE tenant_id = ?`,
                [tenantId]
            );
            const existingOids = new Set((existingOidRows as any[]).map(r => r.entra_oid));
            let count = existingOids.size;
            const userLimit = getUserLimit(tier);

            const adminDomain = currentAdminEmail.split('@')[1]?.toLowerCase();

            for (const user of usersToProcess) {
                // Un usuario que YA existe (re-sync desde Entra, cambio de rol, etc.)
                // no cuenta como alta nueva — solo bloqueamos incorporaciones
                // genuinamente nuevas que llevarían el total por encima del límite.
                const isNewUser = !existingOids.has(user.entraOid);
                if (isNewUser && Number.isFinite(userLimit) && count >= userLimit) {
                    return NextResponse.json({ error: `Límite de usuarios alcanzado para el plan ${tier} (máx. ${userLimit}). Liberá un usuario o actualizá el plan para agregar más.` }, { status: 403 });
                }

                const newEmailDomain = user.email.split('@')[1]?.toLowerCase();
                if (adminDomain && newEmailDomain && adminDomain !== newEmailDomain && !isSuperAdmin) {
                     return NextResponse.json({ error: `El usuario ${user.email} debe pertenecer al dominio registrado (${adminDomain}).` }, { status: 403 });
                }

                let systemRole = 'USER';
                const effectiveRole = user.role || 'Reader';

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
                const permissionsJson = Array.isArray(user.permissions) ? JSON.stringify(user.permissions) : null;
                await connection.execute(
                    `INSERT INTO Users (entra_oid, tenant_id, email, display_name, role, system_role, permissions) VALUES (?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE email = VALUES(email), display_name = VALUES(display_name), role = VALUES(role), system_role = VALUES(system_role),
                                             permissions = COALESCE(VALUES(permissions), permissions)`,
                    [user.entraOid, tenantId, user.email, user.displayName || null, effectiveRole === 'SuperAdmin' ? 'Admin' : effectiveRole, systemRole, permissionsJson]
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
    } catch (e: any) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("Error creating user:", e);
        return NextResponse.json({ error: "Error interno del servidor", details: e.message }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, userId, role, permissions } = body;

        // role y permissions son independientes: se puede mandar solo uno de los
        // dos (editar solo rol, o solo permisos) o ambos juntos.
        if (!tenantId || !userId || (role === undefined && permissions === undefined)) {
            return NextResponse.json({ error: "Faltan parámetros obligatorios." }, { status: 400 });
        }

        const identity = await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
        // Ver nota en POST: `isCorporateDomain` no implica SuperAdmin, hay que
        // verificar system_role='SUPERADMIN' en DB (antes cualquier empleado con
        // email corporativo podía auto-promoverse a Admin en cualquier tenant).
        const isSuperAdmin = identity.isCorporateDomain && await hasSystemRole(identity.email, "SUPERADMIN");

        const connection = await pool.getConnection();
        try {
            if (!isSuperAdmin) {
                 const [adminCheck] = await connection.execute<any>(
                     `SELECT role FROM Users WHERE entra_oid = ? AND tenant_id = ?`,
                     [identity.claims.oid, tenantId]
                 );
                 if (!adminCheck || adminCheck.length === 0 || adminCheck[0].role !== 'Admin') {
                     return NextResponse.json({ error: "Solo los administradores del tenant pueden cambiar roles o permisos." }, { status: 403 });
                 }
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
    } catch (e: any) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("Error updating user role:", e);
        return NextResponse.json({ error: "Error interno", details: e.message }, { status: 500 });
    }
}
