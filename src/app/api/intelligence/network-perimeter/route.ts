/**
 * GET /api/intelligence/network-perimeter — costo real de red perimetral
 * (Firewall, App Gateway/WAF, NAT Gateway, Front Door, VPN Gateway/
 * ExpressRoute, Traffic Manager) por tipo de recurso, vía Cost Management.
 *
 * RBAC app: feature de tier Professional+ → requireTenantTier(..., 'Professional').
 * Roles Azure requeridos: Cost Management Reader (tier Professional del onboarding).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { getPerimeterNetworkCost } from "@/modules/collectors/azure/perimeterNetworkCostService";
import { isMockTenant } from "@/lib/mockData";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { withArgLimit } from "@/lib/argConcurrency";

const PERIMETER_TYPES = [
    "microsoft.network/azurefirewalls", "microsoft.network/applicationgateways",
    "microsoft.network/natgateways", "microsoft.network/frontdoors",
    "microsoft.network/virtualnetworkgateways", "microsoft.network/expressroutecircuits",
];

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        if (!isMockTenant(tenantId)) {
            await requireTenantTier(request, tenantId, "Professional");
        } else {
            await requireTenantAccess(request, tenantId);
        }

        if (isMockTenant(tenantId)) {
            const data = await getPerimeterNetworkCost(null, "", tenantId);
            return NextResponse.json({ success: true, mock: true, ...data });
        }

        let targetSubscriptionId = searchParams.get("subscriptionId") || "";
        let availableSubscriptions: string[] = [];
        try {
            const client = await getResourceGraphClient(tenantId);
            const query = `Resources | where type in (${PERIMETER_TYPES.map((t) => `'${t}'`).join(",")}) | summarize by subscriptionId`;
            const resARG: any = await withArgLimit(() => client.resources({ query, options: { resultFormat: "objectArray", top: 1000 } }));
            availableSubscriptions = ((resARG.data as any[]) || []).map((r) => String(r.subscriptionId)).filter(Boolean);
        } catch (e: unknown) {
            console.warn(`[network-perimeter] No se pudieron listar suscripciones para ${tenantId}:`, e instanceof Error ? e.message : e);
            return NextResponse.json({ success: true, empty: true, message: "No se pudieron listar las suscripciones.", availableSubscriptions: [] });
        }

        if (availableSubscriptions.length === 0) {
            return NextResponse.json({ success: true, empty: true, message: "No se encontraron recursos de red perimetral en el tenant.", availableSubscriptions: [] });
        }
        if (!targetSubscriptionId || !availableSubscriptions.includes(targetSubscriptionId)) {
            targetSubscriptionId = availableSubscriptions[0];
        }

        const data = await getWithStaleWhileRevalidate(
            `network-perimeter:v1:${tenantId}:${targetSubscriptionId}`,
            async () => {
                const credential = await getAzureCredential(tenantId);
                return getPerimeterNetworkCost(credential, targetSubscriptionId, tenantId);
            },
            1800,
            600
        );

        return NextResponse.json({ success: true, mock: false, ...data, availableSubscriptions });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Network Perimeter API Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
