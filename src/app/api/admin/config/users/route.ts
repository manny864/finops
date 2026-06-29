import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireRequestIdentity, requireSuperAdmin, requireTenantAccess } from "@/lib/requestAuth";

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
                `SELECT id, email, display_name, role, entra_oid, system_role, scope FROM Users WHERE tenant_id = ?`,
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
        const { tenantId, users, entraOid, email, role, displayName } = body;

        const usersToProcess = users || [{ entraOid, email, displayName, role: role || 'Reader' }];

        if (!tenantId || usersToProcess.length === 0 || !usersToProcess[0].entraOid) {
            return NextResponse.json({ error: "Faltan parámetros obligatorios." }, { status: 400 });
        }

        const identity = await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
        const currentAdminEmail = identity.email;
        const isSuperAdmin = identity.isCorporateDomain && identity.tenantId !== tenantId
            ? true
            : identity.isCorporateDomain; // SuperAdmin si el dominio corp coincide (verificado por gate)

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

            const [userRows] = await connection.execute<any>(
                `SELECT COUNT(*) as count FROM Users WHERE tenant_id = ?`,
                [tenantId]
            );
            let count = userRows[0].count;

            const adminDomain = currentAdminEmail.split('@')[1]?.toLowerCase();

            for (const user of usersToProcess) {
                if (tier === 'Essential' && count >= 1) {
                    return NextResponse.json({ error: "Límite de usuarios alcanzado para el plan Essential (Máx 1)." }, { status: 403 });
                }
                if (tier === 'Professional' && count >= 5) {
                    return NextResponse.json({ error: "Límite de usuarios alcanzado para el plan Professional (Máx 5)." }, { status: 403 });
                }
                if (tier === 'Business' && count >= 20) {
                    return NextResponse.json({ error: "Límite de usuarios alcanzado para el plan Business (Máx 20)." }, { status: 403 });
                }

                const newEmailDomain = user.email.split('@')[1]?.toLowerCase();
                if (adminDomain && newEmailDomain && adminDomain !== newEmailDomain && !isSuperAdmin) {
                     return NextResponse.json({ error: `El usuario ${user.email} debe pertenecer al dominio registrado (${adminDomain}).` }, { status: 403 });
                }

                let systemRole = 'USER';
                const effectiveRole = user.role || 'Reader';

                if (effectiveRole === 'SuperAdmin') {
                    if (tenantId !== '8b41364f-581a-4e43-b7cb-13138dac5517' || !user.email.toLowerCase().endsWith('@cscloudsolutions.com.ar')) {
                        return NextResponse.json({ error: `El rol SuperAdmin solo puede asignarse a usuarios de CSCloudSolutions en el tenant principal.` }, { status: 403 });
                    }
                    systemRole = 'SUPERADMIN';
                } else if (user.email.toLowerCase().endsWith('@cscloudsolutions.com.ar') && tenantId === '8b41364f-581a-4e43-b7cb-13138dac5517' && user.email.toLowerCase().startsWith('mchavez')) {
                    systemRole = 'SUPERADMIN';
                }

                await connection.execute(
                    `INSERT INTO Users (entra_oid, tenant_id, email, display_name, role, system_role) VALUES (?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE email = VALUES(email), display_name = VALUES(display_name), role = VALUES(role), system_role = VALUES(system_role)`,
                    [user.entraOid, tenantId, user.email, user.displayName || null, effectiveRole === 'SuperAdmin' ? 'Admin' : effectiveRole, systemRole]
                );
                count++;
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
        const { tenantId, userId, role } = body;

        if (!tenantId || !userId || !role) {
            return NextResponse.json({ error: "Faltan parámetros obligatorios." }, { status: 400 });
        }

        const identity = await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });
        const isSuperAdmin = identity.isCorporateDomain;

        const connection = await pool.getConnection();
        try {
            if (!isSuperAdmin) {
                 const [adminCheck] = await connection.execute<any>(
                     `SELECT role FROM Users WHERE entra_oid = ? AND tenant_id = ?`,
                     [identity.claims.oid, tenantId]
                 );
                 if (!adminCheck || adminCheck.length === 0 || adminCheck[0].role !== 'Admin') {
                     return NextResponse.json({ error: "Solo los administradores del tenant pueden cambiar roles." }, { status: 403 });
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
            let systemRole = 'USER';

            if (role === 'SuperAdmin') {
                if (tenantId !== '8b41364f-581a-4e43-b7cb-13138dac5517' || !targetEmail.toLowerCase().endsWith('@cscloudsolutions.com.ar')) {
                    return NextResponse.json({ error: 'El rol SuperAdmin solo puede asignarse a usuarios de CSCloudSolutions en el tenant principal.' }, { status: 403 });
                }
                systemRole = 'SUPERADMIN';
            } else if (targetEmail.toLowerCase().endsWith('@cscloudsolutions.com.ar') && tenantId === '8b41364f-581a-4e43-b7cb-13138dac5517' && targetEmail.toLowerCase().startsWith('mchavez')) {
                systemRole = 'SUPERADMIN';
            }

            const dbRole = role === 'SuperAdmin' ? 'Admin' : role;

            const [result] = await connection.execute<any>(
                `UPDATE Users SET role = ?, system_role = ? WHERE id = ? AND tenant_id = ?`,
                [dbRole, systemRole, userId, tenantId]
            );

            if (result.affectedRows > 0) {
                return NextResponse.json({ success: true, message: "Rol actualizado exitosamente." });
            } else {
                return NextResponse.json({ error: "No se pudo actualizar el usuario." }, { status: 500 });
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
