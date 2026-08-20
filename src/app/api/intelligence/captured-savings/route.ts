import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { AzureCapturedSavingsService } from "@/services/azureCapturedSavings.service";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        const tier = request.nextUrl.searchParams.get("tier") || "Enterprise";

        if (!tenantId) {
            return NextResponse.json({ success: false, error: "Falta tenantId" }, { status: 400 });
        }

        // 1. Check isMockTenant FIRST before any OAuth/Entra tokens
        if (isMockTenant(tenantId)) {
            const summary = AzureCapturedSavingsService.getMockCapturedSavings(tier);
            return NextResponse.json({
                success: true,
                data: summary,
                // Backward compatibility fields
                history: summary.trend.map((t) => ({
                    date: t.date,
                    totalWasted: t.detectedWasteUSD,
                    potentialSavings: t.potentialSavingsUSD,
                    realizedSavings: t.realizedSavingsUSD,
                })),
                current: {
                    potentialSavings: summary.currentPotentialSavingsUSD,
                    totalWasted: summary.currentDetectedWasteUSD,
                    date: summary.lastScanDate || new Date().toISOString().slice(0, 10),
                },
                changePct: summary.changePercentageVsLast,
                topResources: summary.auditLog.map((a) => ({
                    resourceId: a.resourceName,
                    category: a.actionCategory,
                    estimatedSavings: a.monthlySavingsUSD,
                })),
            });
        }

        // 2. Real tenant: require valid token and tenant access
        await requireTenantAccess(request, tenantId);

        const summary = await AzureCapturedSavingsService.getCapturedSavings(tenantId, tier);

        return NextResponse.json({
            success: true,
            data: summary,
            // Backward compatibility fields
            history: summary.trend.map((t) => ({
                date: t.date,
                totalWasted: t.detectedWasteUSD,
                potentialSavings: t.potentialSavingsUSD,
                realizedSavings: t.realizedSavingsUSD,
            })),
            current: summary.trend.length > 0 ? {
                potentialSavings: summary.currentPotentialSavingsUSD,
                totalWasted: summary.currentDetectedWasteUSD,
                date: summary.lastScanDate || new Date().toISOString().slice(0, 10),
            } : null,
            changePct: summary.changePercentageVsLast,
            topResources: summary.auditLog.map((a) => ({
                resourceId: a.resourceName,
                category: a.actionCategory,
                estimatedSavings: a.monthlySavingsUSD,
            })),
        });
    } catch (err: unknown) {
        if (err instanceof AuthError) {
            return NextResponse.json({ success: false, error: err.message }, { status: err.status });
        }
        console.error("[captured-savings] GET error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
    }
}
