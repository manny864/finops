import { NextRequest, NextResponse } from "next/server";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential } from "@/lib/azure";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { errorMessage } from '@/lib/apiErrors';

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('zero_cost', tenantId));
        }

        const cacheKey = `zerocost:${tenantId}`;
        const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
            let credential;
            let client;
            try {
                credential = await getAzureCredential(tenantId);
                client = new ResourceGraphClient(credential);
            } catch (e) {
                console.warn(`[ZeroCost] Sin credenciales para ${tenantId}:`, errorMessage(e));
                return [];
            }

            // La KQL proyecta una CLAVE (`reasonKey`), no la frase. Antes devolvia
            // "Capa Gratuita (Free SKU)" armada acá, y la columna Reason salia en
            // castellano sobre cualquier UI. El servidor no conoce el locale del
            // lector, y esta respuesta encima se cachea (`zerocost:<tenant>`).
            const query = `
                Resources
                | where sku.tier =~ "Free" or sku.name =~ "F1" or sku.name =~ "Free"
                   or type =~ "microsoft.network/virtualnetworks"
                   or type =~ "microsoft.network/networksecuritygroups"
                   or type =~ "microsoft.managedidentity/userassignedidentities"
                | extend ReasonKey = case(
                    sku.tier =~ "Free" or sku.name =~ "F1" or sku.name =~ "Free", "freeTier",
                    "noBaseCost"
                )
                | project id, name, type, resourceGroup, subscriptionId, location,
                          reasonKey = ReasonKey,
                          skuName = coalesce(tostring(sku.name), "N/A")
            `;

            // Paginación completa vía skipToken — ARG limita a 1000 filas por página.
            const all: any[] = [];
            try {
                let skipToken: string | undefined;
                let pages = 0;
                do {
                    const res: any = await client.resources({
                        query,
                        options: {
                            resultFormat: "objectArray",
                            top: 1000,
                            ...(skipToken ? { skipToken } : {})
                        }
                    });
                    if (res.data && Array.isArray(res.data)) all.push(...res.data);
                    skipToken = res.skipToken || res.$skipToken;
                    pages++;
                    if (pages > 50) break; // safety: hasta 50k items
                } while (skipToken);
            } catch (e) {
                console.warn(`[ZeroCost] Query ARG falló para ${tenantId}:`, errorMessage(e));
            }

            return all;
        }, 43200); // 12 hours TTL

        return NextResponse.json({ success: true, data });

    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Zero Cost Inventory Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
