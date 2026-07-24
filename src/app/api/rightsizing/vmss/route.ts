import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getVmssRightsizingRecommendations } from "@/modules/collectors/azure/vmssRightsizingService";
import { getResourceGraphClient } from "@/lib/azure";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { withArgLimit } from "@/lib/argConcurrency";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        try {
            if (!isMockTenant(tenantId)) {
                await requireTenantTier(request, tenantId, "Business");
            } else {
                await requireTenantRole(request, tenantId, ['Admin', 'Owner']);
            }
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        if (isMockTenant(tenantId)) {
            const data = await getVmssRightsizingRecommendations(tenantId, "");
            return NextResponse.json({ success: true, mock: true, ...data });
        }

        // VMSS puede estar en varias suscripciones — recorremos todas las que
        // tengan al menos un scale set (mismo patrón que Container Apps).
        let subscriptionIds: string[] = [];
        try {
            const client = await getResourceGraphClient(tenantId);
            const query = `Resources | where type =~ 'microsoft.compute/virtualmachinescalesets' | summarize by subscriptionId`;
            const resARG: any = await withArgLimit(() => client.resources({ query, options: { resultFormat: "objectArray", top: 1000 } }));
            subscriptionIds = ((resARG.data as any[]) || []).map((r) => String(r.subscriptionId)).filter(Boolean);
        } catch (e: unknown) {
            console.warn(`[rightsizing/vmss] No se pudieron listar suscripciones para ${tenantId}:`, e instanceof Error ? e.message : e);
            return NextResponse.json({ success: true, items: [], totalSavings: 0, dataAvailable: false });
        }

        if (subscriptionIds.length === 0) {
            return NextResponse.json({ success: true, items: [], totalSavings: 0, dataAvailable: true });
        }

        const perSub = await Promise.all(
            subscriptionIds.map((subId) =>
                getWithStaleWhileRevalidate(
                    `vmss-rightsizing:v1:${tenantId}:${subId}`,
                    () => getVmssRightsizingRecommendations(tenantId, subId),
                    1800,
                    600
                )
            )
        );
        const items = perSub.flatMap((r) => r.items);
        const totalSavings = Number(items.reduce((s, i) => s + i.estimatedSavings, 0).toFixed(2));
        const dataAvailable = perSub.every((r) => r.dataAvailable);

        return NextResponse.json({ success: true, mock: false, items, totalSavings, dataAvailable });
    } catch (err: unknown) {
        console.error("[rightsizing/vmss] handler error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ success: false, mock: false, items: [], totalSavings: 0, error: "Internal server error" }, { status: 500 });
    }
}
