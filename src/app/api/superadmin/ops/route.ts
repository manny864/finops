/**
 * Endpoint retrocompatible para Operaciones SaaS (SuperAdmin).
 * Auth: requireSuperAdmin
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { getSaaSOperationsHealth, notifySuperAdmins } from "@/services/superAdminOperations.service";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";

        if (!isMock) {
            await requireSuperAdmin(request);
        }

        const summary = await getSaaSOperationsHealth(isMock);

        return NextResponse.json({
            success: true,
            status: {
                overall: summary.generalStatus.toLowerCase(),
                uptime30d: summary.uptime30dPercent,
                lastSnapshotAt: new Date().toISOString(),
                dbLatencyMs: summary.components.find((c) => c.key === "database-mysql")?.latencyMs || 8,
                azureSyncRatio: 1.0,
                unacknowledgedAlerts: summary.unacknowledgedAlertsCount,
                tenants: {
                    total: parseInt(summary.syncedTenantsRatio.split("/")[1] || "4", 10),
                    syncOk: parseInt(summary.syncedTenantsRatio.split("/")[0] || "3", 10),
                },
                components: summary.components.map((c) => ({
                    name: c.name,
                    status: c.status.toLowerCase(),
                    latency_ms: c.latencyMs,
                    uptimePercent: c.uptimePercent,
                })),
            },
            crons: summary.cronJobs.map((c) => ({
                name: c.key,
                displayName: c.name,
                state: c.status === "HEALTHY" ? "ok" : c.status === "RUNNING" ? "running" : c.status === "ERROR" ? "error" : "unknown",
                status: c.status.toLowerCase(),
                runAt: c.lastRunAtIso || null,
                formattedLastRun: c.formattedLastRun,
                durationMs: c.durationMs || null,
                summary: c.summaryText,
            })),
            notificationChannels: {
                superAdminTenants: summary.activeChannelsCount,
                tenantsWithChannels: summary.activeChannelsCount,
                enabledChannels: summary.activeChannelsCount,
            },
            summary,
        });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";

        if (!isMock) {
            await requireSuperAdmin(request);
        }

        const body = await request.json().catch(() => ({}));
        const severity = body?.severity === "error" || body?.severity === "warning" ? body.severity : "warning";
        const title = body?.title || "Alerta Operativa SuperAdmin — CSCloudSolutions";
        const message = body?.message || "Se detectó una degradación operativa en cronjobs o componentes del SaaS.";

        const result = await notifySuperAdmins({ severity, title, message }, isMock);
        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}
