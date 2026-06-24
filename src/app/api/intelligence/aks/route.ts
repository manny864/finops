import { NextRequest, NextResponse } from "next/server";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { CostManagementClient } from "@azure/arm-costmanagement";
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
            return NextResponse.json(getMockDataForRoute('aks', tenantId));
        }

        const cacheKey = `aks_intelligence:${tenantId}`;
        const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
            const credential = await getAzureCredential(tenantId);
            
            // 1. Obtener la lista de clústeres de AKS y sus Node Resource Groups usando ARG
            const argClient = new ResourceGraphClient(credential);
            const query = `
                Resources
                | where type =~ "microsoft.containerservice/managedclusters"
                | project id, name, resourceGroup, subscriptionId, location, nodeResourceGroup = tostring(properties.nodeResourceGroup)
            `;

            const argResult = await argClient.resources({
                query,
                options: {
                    resultFormat: "objectArray"
                }
            });

            const clusters = argResult.data || [];

            if (clusters.length === 0) {
                return [];
            }

            // 2. Obtener el costo agrupado por ResourceGroupName a través de Cost Management
            const costClient = new CostManagementClient(credential);
            
            // Limitamos a consultar el Management Group o la primera suscripción si no hay permisos de MG
            // Para simplificar, si no es admin, consultaremos a nivel tenant. Si falla, caerá al catch.
            const scope = `/providers/Microsoft.Management/managementGroups/${tenantId}`;
            
            let rgCosts: Record<string, number> = {};
            try {
                const costRes = await costClient.query.usage(scope, {
                    type: "Usage",
                    timeframe: "MonthToDate",
                    dataset: {
                        granularity: "None", // Sin granularidad temporal para obtener solo la suma total
                        aggregation: {
                            totalCost: { name: "PreTaxCost", function: "Sum" }
                        },
                        grouping: [{ type: "Dimension", name: "ResourceGroupName" }]
                    }
                });

                if (costRes.rows) {
                    costRes.rows.forEach(row => {
                        const cost = parseFloat(row[0] as string);
                        const rgName = (row[1] as string)?.toLowerCase();
                        if (rgName) {
                            rgCosts[rgName] = cost;
                        }
                    });
                }
            } catch (costError: any) {
                console.error("Error al consultar Cost Management a nivel tenant:", costError.message);
                // Si el alcance falla, el costo quedará en 0, pero seguimos devolviendo la estructura de los clústeres.
            }

            // 3. Cruzar la información
            const finalData = clusters.map((cluster: any) => {
                const nodeRg = cluster.nodeResourceGroup ? cluster.nodeResourceGroup.toLowerCase() : "";
                const mainRg = cluster.resourceGroup ? cluster.resourceGroup.toLowerCase() : "";
                
                // El costo total del clúster es el costo de su Node RG (VMSS, Discos, LBs) 
                // + el costo de su RG principal (costos de Uptime SLA si aplican)
                const costNodeRg = rgCosts[nodeRg] || 0;
                const costMainRg = rgCosts[mainRg] || 0; // Opcional, pero el grueso suele estar en el Node RG.

                return {
                    id: cluster.id,
                    name: cluster.name,
                    resourceGroup: cluster.resourceGroup,
                    nodeResourceGroup: cluster.nodeResourceGroup,
                    location: cluster.location,
                    subscriptionId: cluster.subscriptionId,
                    totalCost: costNodeRg,
                    hasCostData: !!rgCosts[nodeRg] || !!rgCosts[mainRg]
                };
            });

            return finalData.sort((a: any, b: any) => b.totalCost - a.totalCost);

        }, 43200); // 12 hours TTL

        return NextResponse.json({ success: true, data });

    } catch (error: any) {
        console.error("AKS Intelligence Error:", error);
        return NextResponse.json({ error: "Fallo al consultar el inventario de AKS", details: error.message }, { status: 500 });
    }
}
