import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { serverError } from "@/lib/apiErrors";
import { deleteAttachmentFile, SUPPORT_ATTACHMENT_RETENTION_DAYS } from "@/lib/supportAttachments";

/**
 * Cron de retención de adjuntos de soporte: elimina archivo + fila de los
 * adjuntos con más de 60 días (SUPPORT_ATTACHMENT_RETENTION_DAYS).
 * Idempotente: si el archivo ya no existe, la fila se borra igual.
 *
 * Agendado en el crontab del VPS (diario) con `Authorization: Bearer $CRON_SECRET`,
 * mismo patrón que /api/cron/trial-expiry.
 */
export async function GET(request: NextRequest) {
    try {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || cronSecret.length < 16) {
            console.error("CRON_SECRET not configured or too short");
            return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
        }
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        await initializeDatabase();

        const [rows]: any = await pool.query(
            `SELECT id, stored_name FROM SupportTicketAttachments
             WHERE created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
             LIMIT 500`,
            [SUPPORT_ATTACHMENT_RETENTION_DAYS]
        );

        let deleted = 0;
        for (const row of rows || []) {
            await deleteAttachmentFile(row.stored_name);
            await pool.query("DELETE FROM SupportTicketAttachments WHERE id = ?", [row.id]);
            deleted++;
        }

        return NextResponse.json({ success: true, deleted, retentionDays: SUPPORT_ATTACHMENT_RETENTION_DAYS });
    } catch (e: unknown) {
        return serverError(e, { context: "GET /api/cron/support-attachments-cleanup" });
    }
}
