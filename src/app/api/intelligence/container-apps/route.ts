/**
 * GET /api/intelligence/container-apps — control de costos de Azure Container
 * Apps (Microsoft.App/containerApps): inventario, costo MonthToDate por app y
 * oportunidades de scale-to-zero.
 *
 * RBAC app: feature de tier Business+ → requireTenantTier(..., 'Business').
 *   Tenants mock (demo) pasan por requireTenantAccess y reciben datos sintéticos.
 * Roles Azure requeridos (Service Principal del tenant, solo lectura):
 *   - Reader (Resource Graph) para inventariar los Container Apps.
 *   - Cost Management Reader para el costo por recurso.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { getContainerAppsCost } from "@/modules/collectors/azure/containerAppsCostService";
import { isMockTenant } from "@/lib/mockData";
import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { withArgLimit } from "@/lib/argConcurrency";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");

        if (!tenantId) {
            return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });
        }

        if (!isMockTenant(tenantId)) {
            await requireTenantTier(request, tenantId, "Business");
        } else {
            await requireTenantAccess(request, tenantId);
        }

        // Selección de suscripción: explícita vía ?subscriptionId, o autodescubrimos
        // la primera suscripción que tenga Container Apps. Si ARG falla, degradamos
        // a "All" en vez de responder vacío (evita cargas intermitentes).
        let targetSubscriptionId = searchParams.get("subscriptionId") || "";
        let availableSubscriptions: string[] = [];
        let selectedSubscriptionName = "N/A";

        if (!isMockTenant(tenantId)) {
            try {
                const client = await getResourceGraphClient(tenantId);
                const query = `
                    Resources
                    | where type =~ 'microsoft.app/containerapps'
                    | summarize by subscriptionId
                `;
                const resARG: any = await withArgLimit(() =>
                    client.resources({ query, options: { resultFormat: "objectArray", top: 1000 } })
                );
                availableSubscriptions = ((resARG.data as any[]) || [])
                    .map((r) => String(r.subscriptionId))
                    .filter(Boolean);
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                console.warn(`[Container Apps] No se pudieron listar suscripciones para ${tenantId}:`, message);
                availableSubscriptions = [];
            }

            if (availableSubscriptions.length > 0 && (!targetSubscriptionId || !availableSubscriptions.includes(targetSubscriptionId))) {
                targetSubscriptionId = availableSubscriptions[0];
            }
            if (!targetSubscriptionId) targetSubscriptionId = "All";

            const credential = await getAzureCredential(tenantId);
            const subscriptionNameMap = await getSubscriptionNameMap(tenantId, credential);
            selectedSubscriptionName = targetSubscriptionId === "All"
                ? "All subscriptions"
                : (resolveSubscriptionName(targetSubscriptionId, subscriptionNameMap) || targetSubscriptionId);
        } else {
            selectedSubscriptionName = "Demo Subscription";
        }

        const data = await getWithStaleWhileRevalidate(
            `containerapps:cost:v1:${tenantId}:${targetSubscriptionId}`,
            () => getContainerAppsCost(tenantId, targetSubscriptionId),
            1800,
            600
        );

        return NextResponse.json({ success: true, ...data, availableSubscriptions, selectedSubscriptionName, selectedSubscriptionId: targetSubscriptionId });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Container Apps API Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
