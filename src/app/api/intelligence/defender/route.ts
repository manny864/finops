/**
 * GET /api/intelligence/defender — planes de Microsoft Defender for Cloud
 * (Standard/Free) por suscripción y costo real MonthToDate.
 * PATCH — cambia el tier de un plan puntual (Standard→Free en subs Dev/Test).
 *
 * RBAC app: feature de tier Business+ → requireTenantTier(..., 'Business').
 * Roles Azure requeridos (Service Principal del tenant):
 *   - Reader/Security Reader para listar planes.
 *   - Cost Management Reader para el costo.
 *   - Security Admin SOLO para el PATCH (mutación real en Azure).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { getDefenderCost, setDefenderPlanTier } from "@/modules/collectors/azure/defenderCostService";
import { isMockTenant } from "@/lib/mockData";
import { getResourceGraphClient } from "@/lib/azure";
import { getWithStaleWhileRevalidate, invalidateCache } from "@/lib/cache";
import { withArgLimit } from "@/lib/argConcurrency";

async function listSubscriptions(tenantId: string): Promise<string[]> {
    const client = await getResourceGraphClient(tenantId);
    const query = `ResourceContainers | where type =~ 'microsoft.resources/subscriptions' | project subscriptionId`;
    const resARG: any = await withArgLimit(() => client.resources({ query, options: { resultFormat: "objectArray", top: 1000 } }));
    return ((resARG.data as any[]) || []).map((r) => String(r.subscriptionId)).filter(Boolean);
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        if (isMockTenant(tenantId)) {
            const data = await getDefenderCost(tenantId, []);
            return NextResponse.json({ success: true, mock: true, ...data });
        }

        await requireTenantTier(request, tenantId, "Business");

        let subscriptionIds: string[] = [];
        if (!isMockTenant(tenantId)) {
            try {
                subscriptionIds = await listSubscriptions(tenantId);
            } catch (e: unknown) {
                console.warn(`[Defender] No se pudieron listar suscripciones para ${tenantId}:`, e instanceof Error ? e.message : e);
                return NextResponse.json({ success: true, empty: true, message: "No se pudieron listar las suscripciones.", plans: [] });
            }
        }

        const data = await getWithStaleWhileRevalidate(
            `defender:cost:v1:${tenantId}`,
            () => getDefenderCost(tenantId, subscriptionIds),
            1800,
            600
        );

        return NextResponse.json({ success: true, mock: false, ...data });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Defender API Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const { tenantId, subscriptionId, planName, pricingTier } = body as {
            tenantId?: string; subscriptionId?: string; planName?: string; pricingTier?: "Standard" | "Free";
        };
        if (!tenantId || !subscriptionId || !planName || !pricingTier) {
            return NextResponse.json({ error: "Faltan parámetros requeridos" }, { status: 400 });
        }
        if (isMockTenant(tenantId)) {
            return NextResponse.json({ error: "No se puede modificar un tenant demo" }, { status: 400 });
        }

        await requireTenantTier(request, tenantId, "Business");

        await setDefenderPlanTier(tenantId, subscriptionId, planName, pricingTier);
        await invalidateCache(`defender:cost:v1:${tenantId}`);

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Defender PATCH Error:", error);
        return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
    }
}
