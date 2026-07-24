/**
 * GET /api/intelligence/app-insights — costo real por recurso Application
 * Insights, separado del costo de Log Analytics.
 *
 * RBAC app: feature de tier Business+ → requireTenantTier(..., 'Business').
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { getAppInsightsCost } from "@/modules/collectors/azure/appInsightsCostService";
import { isMockTenant } from "@/lib/mockData";
import { getResourceGraphClient } from "@/lib/azure";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { withArgLimit } from "@/lib/argConcurrency";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        if (!isMockTenant(tenantId)) {
            await requireTenantTier(request, tenantId, "Business");
        } else {
            await requireTenantAccess(request, tenantId);
        }

        let targetSubscriptionId = searchParams.get("subscriptionId") || "";
        let availableSubscriptions: string[] = [];

        if (!isMockTenant(tenantId)) {
            try {
                const client = await getResourceGraphClient(tenantId);
                const query = `Resources | where type =~ 'microsoft.insights/components' | summarize by subscriptionId`;
                const resARG: any = await withArgLimit(() => client.resources({ query, options: { resultFormat: "objectArray", top: 1000 } }));
                availableSubscriptions = ((resARG.data as any[]) || []).map((r) => String(r.subscriptionId)).filter(Boolean);
            } catch (e: unknown) {
                console.warn(`[App Insights] No se pudieron listar suscripciones para ${tenantId}:`, e instanceof Error ? e.message : e);
                return NextResponse.json({ success: true, empty: true, message: "No se pudieron listar los recursos.", availableSubscriptions: [] });
            }
            if (availableSubscriptions.length === 0) {
                return NextResponse.json({ success: true, empty: true, message: "No se encontraron recursos Application Insights en el tenant.", availableSubscriptions: [] });
            }
            if (!targetSubscriptionId || !availableSubscriptions.includes(targetSubscriptionId)) {
                targetSubscriptionId = availableSubscriptions[0];
            }
        }

        const data = await getWithStaleWhileRevalidate(
            `appinsights:cost:v1:${tenantId}:${targetSubscriptionId}`,
            () => getAppInsightsCost(tenantId, targetSubscriptionId),
            1800,
            600
        );

        return NextResponse.json({ success: true, mock: isMockTenant(tenantId), ...data, availableSubscriptions });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("App Insights API Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
