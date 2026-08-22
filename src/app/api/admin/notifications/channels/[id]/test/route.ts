/**
 * Test notification channel endpoint.
 * Sends a test payload to a specific channel.
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireTenantRole } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { notifyTenant } from "@/lib/notifications";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const body = await request.json().catch(() => ({}));
        const { tenantId } = body as { tenantId?: string };

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        // Fetch channel
        const [rows] = await pool.query(
            "SELECT id, type, name, config_json FROM NotificationChannels WHERE id=? AND tenant_id=?",
            [parseInt(id), tenantId]
        );

        if ((rows as any[]).length === 0) {
            return NextResponse.json({ success: false, error: "Channel not found" }, { status: 404 });
        }

        const channel = (rows as any[])[0];

        // Send test notification
        const result = await notifyTenant(tenantId, {
            title: `Test: ${channel.name}`,
            message: "This is a test notification from FinOps SaaS. If you received this, your notification channel is working correctly.",
            severity: "info",
            link: "https://app.finops.example.com/admin/notifications",
        });

        const channelResult = result.results.find((r) => r.channelId === channel.id);

        if (channelResult?.success) {
            return NextResponse.json({ success: true, message: "Test notification sent successfully" });
        } else {
            return NextResponse.json(
                { success: false, error: channelResult?.error || "Failed to send test notification" },
                { status: 500 }
            );
        }
    } catch (err) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(err) }, { status: errorStatus(err) });
        }
        return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 500 });
    }
}
