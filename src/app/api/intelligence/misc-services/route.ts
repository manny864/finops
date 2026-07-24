/**
 * GET /api/intelligence/misc-services — costo real de servicios sin página
 * dedicada (AVD, ACI, Batch, NetApp Files, PostgreSQL/MySQL, Synapse/Data
 * Factory, Databricks, Redis, Key Vault). Feature Essential — solo visibilidad.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getAzureCredential, getResourceGraphClient } from "@/lib/azure";
import { getMiscServicesCost, MISC_SERVICE_TYPES } from "@/modules/collectors/azure/miscServicesCostService";
import { isMockTenant } from "@/lib/mockData";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { withArgLimit } from "@/lib/argConcurrency";

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            const data = await getMiscServicesCost(null, "", tenantId);
            return NextResponse.json({ success: true, mock: true, ...data });
        }

        let targetSubscriptionId = searchParams.get("subscriptionId") || "";
        let availableSubscriptions: string[] = [];
        try {
            const client = await getResourceGraphClient(tenantId);
            const types = Object.keys(MISC_SERVICE_TYPES).map((t) => `'${t}'`).join(",");
            const query = `Resources | where type in (${types}) | summarize by subscriptionId`;
            const resARG: any = await withArgLimit(() => client.resources({ query, options: { resultFormat: "objectArray", top: 1000 } }));
            availableSubscriptions = ((resARG.data as any[]) || []).map((r) => String(r.subscriptionId)).filter(Boolean);
        } catch (e: unknown) {
            console.warn(`[misc-services] No se pudieron listar suscripciones para ${tenantId}:`, e instanceof Error ? e.message : e);
            return NextResponse.json({ success: true, empty: true, message: "No se pudieron listar las suscripciones.", availableSubscriptions: [] });
        }

        if (availableSubscriptions.length === 0) {
            return NextResponse.json({ success: true, empty: true, message: "No se encontraron recursos de estos servicios en el tenant.", availableSubscriptions: [] });
        }
        if (!targetSubscriptionId || !availableSubscriptions.includes(targetSubscriptionId)) {
            targetSubscriptionId = availableSubscriptions[0];
        }

        const data = await getWithStaleWhileRevalidate(
            `misc-services:v1:${tenantId}:${targetSubscriptionId}`,
            async () => {
                const credential = await getAzureCredential(tenantId);
                return getMiscServicesCost(credential, targetSubscriptionId, tenantId);
            },
            1800,
            600
        );

        return NextResponse.json({ success: true, mock: false, ...data, availableSubscriptions });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Misc Services API Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
