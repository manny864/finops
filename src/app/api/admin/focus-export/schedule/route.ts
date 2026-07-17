import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantRole, requireTenantTier } from "@/lib/requestAuth";

/**
 * Programación diaria automática del export FOCUS 1.1 (manual de usuario:
 * "programable para generación diaria automática" — antes solo existía la
 * búsqueda manual por rango de fechas). El cron
 * /api/cron/focus-export-daily evalúa las filas enabled=TRUE cada día y
 * manda el export de "ayer" por email como adjunto.
 */

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) {
            return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["ADMIN", "OWNER"]);

        const [rows] = await pool.query(
            `SELECT enabled, format, subscription_id, recipient_email, last_run_at
             FROM FocusExportSchedules WHERE tenant_id = ? LIMIT 1`,
            [tenantId]
        );
        const row = (rows as any[])[0];

        return NextResponse.json({
            success: true,
            enabled: Boolean(row?.enabled ?? false),
            format: row?.format || "csv",
            subscriptionId: row?.subscription_id || "",
            recipientEmail: row?.recipient_email || "",
            lastRunAt: row?.last_run_at || null,
        });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[admin/focus-export/schedule] GET error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { tenantId, enabled, format, subscriptionId, recipientEmail } = body as {
            tenantId?: string;
            enabled?: boolean;
            format?: string;
            subscriptionId?: string;
            recipientEmail?: string;
        };

        if (!tenantId) {
            return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        }
        if (enabled && !recipientEmail?.trim()) {
            return NextResponse.json({ error: "Falta el email destinatario para habilitar la programación" }, { status: 400 });
        }
        if (format && !["csv", "json"].includes(format)) {
            return NextResponse.json({ error: "format debe ser csv o json" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["ADMIN", "OWNER"]);
        // FOCUS 1.1 Export es feature Enterprise (mismo gate que el export manual).
        await requireTenantTier(request, tenantId, "Enterprise");

        await pool.query(
            `INSERT INTO FocusExportSchedules (tenant_id, enabled, format, subscription_id, recipient_email)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                enabled = VALUES(enabled),
                format = VALUES(format),
                subscription_id = VALUES(subscription_id),
                recipient_email = VALUES(recipient_email)`,
            [tenantId, Boolean(enabled), format || "csv", subscriptionId?.trim() || null, recipientEmail?.trim() || ""]
        );

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[admin/focus-export/schedule] PATCH error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
