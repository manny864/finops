/**
 * Endpoint retrocompatible para Alertas de Partner Center (SuperAdmin).
 * Auth: requireSuperAdmin
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { getPartnerCenterStatus } from "@/services/superAdminPartnerCenter.service";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";

        if (!isMock) {
            await requireSuperAdmin(request);
        }

        const result = await getPartnerCenterStatus(isMock);

        return NextResponse.json({
            success: true,
            summary: {
                linked: result.metrics.linkedPalCount,
                approvedPending: result.metrics.approvedPendingCount,
                failed: result.metrics.linkErrorCount,
                recent7d: result.metrics.eventsLast7DaysCount,
            },
            alerts: result.items.map((i) => ({
                tenantId: i.tenantId,
                tenantName: i.organizationName,
                tier: i.planTier,
                status: i.status === "LINKED" ? "LINKED" : i.status === "APPROVED_PENDING" ? "APPROVED" : "FAILED",
                detail: i.errorDetailsText || null,
                approvedBy: i.approvedByEmail,
                approvedAt: i.approvedAtIso,
                severity: i.status === "LINKED" ? "success" : i.status === "APPROVED_PENDING" ? "warning" : "error",
                isRecent: true,
            })),
            metrics: result.metrics,
            items: result.items,
            partnerMpnConfigured: result.partnerMpnConfigured,
            currentPartnerMpnId: result.currentPartnerMpnId,
            schemaReady: true,
        });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}
