import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

export async function PATCH(request: NextRequest) {
    try {
        const actor = await requireSuperAdmin(request);

        const connection = await pool.getConnection();
        try {
            const body = await request.json();
            const { targetUserId } = body;

            if (!targetUserId) {
                return NextResponse.json({ error: "Falta targetUserId." }, { status: 400 });
            }

            const [targetUserRows] = await connection.execute<any>(
                `SELECT email, tenant_id FROM Users WHERE id = ?`,
                [targetUserId]
            );

            if (targetUserRows.length === 0) {
                 return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 });
            }

            if (!targetUserRows[0].email.toLowerCase().endsWith("@cscloudsolutions.com.ar")) {
                 return NextResponse.json({ error: "Solo se puede promover a usuarios internos." }, { status: 403 });
            }

            // APPSEC-ID-07: promoción y evento de auditoría en una transacción;
            // sin auditoría persistida no hay promoción.
            await connection.beginTransaction();
            try {
                await connection.execute(
                    `UPDATE Users SET system_role = 'SUPERADMIN' WHERE id = ?`,
                    [targetUserId]
                );
                await connection.execute(
                    `INSERT INTO AuditTrailLogs (tenant_id, user_email, user_name, action_type, resource_target_id, resource_target_name, status, metadata_json)
                     VALUES (?, ?, 'SuperAdmin Operator', 'SUPERADMIN_PROMOTED', ?, ?, 'SUCCESS', ?)`,
                    [targetUserRows[0].tenant_id, actor.email, String(targetUserId), targetUserRows[0].email, JSON.stringify({ promotedBy: actor.email })]
                );
                await connection.commit();
            } catch (e) {
                await connection.rollback();
                throw e;
            }

            return NextResponse.json({ success: true, message: "Usuario promovido a SUPERADMIN exitosamente." });
        } finally {
            connection.release();
        }
    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        console.error("[SuperAdmin Promote Error]", error);
        return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
    }
}
