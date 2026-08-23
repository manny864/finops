/**
 * Endpoint compatible para el Embudo de Inscripción (SuperAdmin).
 * Auth: requireSuperAdmin
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { getSignupFunnelAnalytics } from "@/services/superAdminFunnel.service";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const isMock = searchParams.get("mock") === "true";

        if (!isMock) {
            await requireSuperAdmin(request);
        }

        const status = searchParams.get("status") || undefined;
        const plan = searchParams.get("plan") || undefined;
        const searchEmail = searchParams.get("q") || searchParams.get("email") || undefined;

        const result = await getSignupFunnelAnalytics(
            { status, plan, searchEmail },
            isMock
        );

        // Mapeo retrocompatible para interfaces previas
        return NextResponse.json({
            success: true,
            kpis: {
                signups_30d: result.metrics.totalSignups30d,
                trials_active: result.metrics.activeTrials,
                converted: result.metrics.convertedCount,
                conversion_pct: result.metrics.conversionRatePercent.toFixed(2),
                churn_pct: result.metrics.churnRatePercent.toFixed(2),
            },
            funnel: result.metrics.funnelSteps.map((s) => ({
                stage: s.stepKey,
                displayName: s.stepDisplayName,
                count: s.count,
                percentage: s.percentage,
            })),
            recent_signups: result.recentSignups.map((s) => ({
                id: s.id,
                tenant_id: s.tenantId,
                email: s.userEmail,
                plan: s.planTier,
                status: s.status,
                trial_days_left: s.trialDaysRemaining,
                created_at: s.signedUpAtIso,
                formatted_date: s.formattedDate,
            })),
            metrics: result.metrics,
            recentSignups: result.recentSignups,
        });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ success: false, error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ success: false, error: errorMessage(error) }, { status: 500 });
    }
}
