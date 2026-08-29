// Route: /api/intelligence/billing
// Purpose: Real consumption dynamic monitor with burn rate, MoM variation, anomalies and resource drill-down
// Auth: requireTenantAccess
// Tier: Professional+

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getCachedCarbonFootprint } from "@/lib/carbonFootprint";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { getRealConsumptionOverview, getMockRealConsumptionOverview } from "@/services/realConsumptionService";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        const subscriptionId = searchParams.get("subscriptionId") || "All";
        const isMock = isMockTenant(tenantId);

        // El inventario ARM + Cost Management de un tenant grande tarda más que
        // los 100s que aguanta Cloudflare: sin cache la página devolvía 524.
        // Mismo patrón SWR que el resto de las rutas del cockpit.
        const [overview, carbonFootprint] = await Promise.all([
            isMock
                ? Promise.resolve(getMockRealConsumptionOverview(tenantId))
                : getWithStaleWhileRevalidate(
                      `real-consumption:v1:${tenantId}:${subscriptionId}`,
                      () => getRealConsumptionOverview(tenantId, subscriptionId),
                      900,
                      300,
                  ),
            getCachedCarbonFootprint(tenantId, "All").catch(() => null),
        ]);
        let environmentalImpact = 0;
        let environmentalImpactSource: "avoided" | "footprint" | "none" = "none";
        if (carbonFootprint && !carbonFootprint.degraded) {
            const avoided = Number(carbonFootprint.avoided || 0);
            const footprint = Number(carbonFootprint.footprint || 0);
            if (avoided > 0) {
                environmentalImpact = avoided;
                environmentalImpactSource = "avoided";
            } else if (footprint > 0) {
                environmentalImpact = footprint;
                environmentalImpactSource = "footprint";
            }
        }

        // Backward-compatible breakdown array for existing consumers
        const breakdown = overview.services.map((svc) => ({
            name: svc.serviceName,
            cost: svc.totalCost,
            pct: svc.percentageOfTotal,
        }));

        return NextResponse.json({
            success: true,
            mock: isMock,
            source: overview.source,
            totalCost: overview.totalCost,
            projectedCost: overview.projectedCost,
            dailyBurnRate: overview.dailyBurnRate,
            momVariation: overview.momVariation,
            daysElapsed: overview.daysElapsed,
            daysInMonth: overview.daysInMonth,
            hasAnomalies: overview.hasAnomalies,
            anomalyCount: overview.anomalyCount,
            topServices: overview.topServices,
            services: overview.services,
            top5ShareOfWallet: overview.top5ShareOfWallet,
            billedCostTotal: overview.billedCostTotal,
            effectiveCostTotal: overview.effectiveCostTotal,
            currency: overview.currency,
            breakdown,
            environmentalImpact,
            environmentalImpactSource,
            byRegion: carbonFootprint?.byRegion || [],
            period: overview.period,
            overview,
        });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[/api/intelligence/billing]", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}

