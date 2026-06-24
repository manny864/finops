import { NextRequest, NextResponse } from "next/server";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential } from "@/lib/azure";
import jwt from "jsonwebtoken";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Estructura de token inválida." }, { status: 401 });
        }

        const email = decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "";
        const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

        if (decoded.tid !== tenantId && !isAdmin) {
            return NextResponse.json({ error: `Acceso denegado. El token no coincide con el tenant.` }, { status: 403 });
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('zero_cost', tenantId));
        }

        const cacheKey = `zerocost:${tenantId}`;
        const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
            const credential = await getAzureCredential(tenantId);
            const client = new ResourceGraphClient(credential);

            const query = `
                Resources
                | where sku.tier =~ "Free" or sku.name =~ "F1" or sku.name =~ "Free"
                   or type =~ "microsoft.network/virtualnetworks"
                   or type =~ "microsoft.network/networksecuritygroups"
                   or type =~ "microsoft.managedidentity/userassignedidentities"
                | extend MotivoGratuidad = case(
                    sku.tier =~ "Free" or sku.name =~ "F1" or sku.name =~ "Free", "Capa Gratuita (Free SKU)",
                    "Servicio de Gestión / Arquitectura (Sin costo base)"
                )
                | project id, name, type, resourceGroup, Motivo = MotivoGratuidad, skuName = coalesce(tostring(sku.name), "N/A")
            `;

            // Query at Tenant scope, but limit to Subscriptions user has access to
            // Note: Since ARG requires subscriptions explicitly or it queries all authorized, we can just omit subscriptions to query all authorized subs in tenant
            const result = await client.resources({
                query,
                options: {
                    resultFormat: "objectArray"
                }
            });

            return result.data || [];
        }, 43200); // 12 hours TTL

        return NextResponse.json({ success: true, data });

    } catch (error: any) {
        console.error("Zero Cost Inventory Error:", error);
        return NextResponse.json({ error: "Fallo al consultar el inventario de Costo Cero", details: error.message }, { status: 500 });
    }
}
