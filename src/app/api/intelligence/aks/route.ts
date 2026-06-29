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

            // 1. Inventario de clústeres AKS vía ARG con paginación completa.
            const argClient = new ResourceGraphClient(credential);
            const query = `
                Resources
                | where type =~ "microsoft.containerservice/managedclusters"
                | project id, name, resourceGroup, subscriptionId, location, nodeResourceGroup = tostring(properties.nodeResourceGroup)
            `;

            const clusters: any[] = [];
            let skipToken: string | undefined;
            let pages = 0;
            do {
                const r: any = await argClient.resources({
                    query,
                    options: { resultFormat: "objectArray", top: 1000, ...(skipToken ? { skipToken } : {}) }
                });
                if (Array.isArray(r.data)) clusters.push(...r.data);
                skipToken = r.skipToken || r.$skipToken;
                pages++;
                if (pages > 20) break;
            } while (skipToken);

            if (clusters.length === 0) return [];

            // 2. Costos por (subscriptionId, resourceGroup) — clave compuesta para evitar
            //    colisiones cross-sub (mismo nombre de RG en distintas subs).
            const costClient = new CostManagementClient(credential);
            const scope = `/providers/Microsoft.Management/managementGroups/${tenantId}`;

            // Clave: `${subId}::${rgLower}` -> cost
            const rgCosts: Record<string, number> = {};
            // Costo específico del control plane AKS (Uptime SLA), keyed por resourceId del cluster.
            const aksServiceCostByResourceId: Record<string, number> = {};

            try {
                const costRes = await costClient.query.usage(scope, {
                    type: "Usage",
                    timeframe: "MonthToDate",
                    dataset: {
                        granularity: "None",
                        aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } },
                        grouping: [
                            { type: "Dimension", name: "ResourceGroupName" },
                            { type: "Dimension", name: "SubscriptionId" }
                        ]
                    }
                });

                if (costRes.rows && costRes.columns) {
                    const colIdx = (name: string) => costRes.columns!.findIndex((c: any) => String(c.name).toLowerCase() === name.toLowerCase());
                    const iCost = colIdx("PreTaxCost") >= 0 ? colIdx("PreTaxCost") : 0;
                    const iRg = colIdx("ResourceGroupName") >= 0 ? colIdx("ResourceGroupName") : 1;
                    const iSub = colIdx("SubscriptionId") >= 0 ? colIdx("SubscriptionId") : 2;
                    costRes.rows.forEach(row => {
                        const cost = Number(row[iCost]) || 0;
                        const rg = String(row[iRg] || "").toLowerCase();
                        const sub = String(row[iSub] || "").toLowerCase();
                        if (rg && sub) rgCosts[`${sub}::${rg}`] = (rgCosts[`${sub}::${rg}`] || 0) + cost;
                    });
                }
            } catch (costError: any) {
                console.warn("[AKS] Sin permiso para costos a nivel Management Group:", costError?.message);
            }

            // Costo SOLO del servicio AKS (control plane / Uptime SLA), aislado del resto del RG principal.
            try {
                const aksOnly = await costClient.query.usage(scope, {
                    type: "Usage",
                    timeframe: "MonthToDate",
                    dataset: {
                        granularity: "None",
                        aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } },
                        grouping: [{ type: "Dimension", name: "ResourceId" }],
                        filter: {
                            dimensions: {
                                name: "ServiceName",
                                operator: "In",
                                values: ["Azure Kubernetes Service"]
                            }
                        }
                    }
                });

                if (aksOnly.rows && aksOnly.columns) {
                    const colIdx = (name: string) => aksOnly.columns!.findIndex((c: any) => String(c.name).toLowerCase() === name.toLowerCase());
                    const iCost = colIdx("PreTaxCost") >= 0 ? colIdx("PreTaxCost") : 0;
                    const iRid = colIdx("ResourceId") >= 0 ? colIdx("ResourceId") : 1;
                    aksOnly.rows.forEach(row => {
                        const cost = Number(row[iCost]) || 0;
                        const rid = String(row[iRid] || "").toLowerCase();
                        if (rid) aksServiceCostByResourceId[rid] = (aksServiceCostByResourceId[rid] || 0) + cost;
                    });
                }
            } catch (e: any) {
                console.warn("[AKS] No se pudo aislar el costo del control plane:", e?.message);
            }

            // 3. Cruce: nodeRG (VMSS, discos, LBs) + costo del propio cluster (control plane).
            const finalData = clusters.map((cluster: any) => {
                const subLower = (cluster.subscriptionId || "").toLowerCase();
                const nodeRgLower = (cluster.nodeResourceGroup || "").toLowerCase();
                const idLower = (cluster.id || "").toLowerCase();

                const nodeRgCost = nodeRgLower && subLower ? (rgCosts[`${subLower}::${nodeRgLower}`] || 0) : 0;
                const controlPlaneCost = aksServiceCostByResourceId[idLower] || 0;
                const totalCost = nodeRgCost + controlPlaneCost;

                return {
                    id: cluster.id,
                    name: cluster.name,
                    resourceGroup: cluster.resourceGroup,
                    nodeResourceGroup: cluster.nodeResourceGroup,
                    location: cluster.location,
                    subscriptionId: cluster.subscriptionId,
                    nodeRgCost,
                    controlPlaneCost,
                    totalCost,
                    hasCostData: nodeRgCost > 0 || controlPlaneCost > 0
                };
            });

            return finalData.sort((a: any, b: any) => b.totalCost - a.totalCost);

        }, 43200);

        return NextResponse.json({ success: true, data });

    } catch (error: any) {
        console.error("AKS Intelligence Error:", error);
        return NextResponse.json({ error: "Fallo al consultar el inventario de AKS", details: error.message }, { status: 500 });
    }
}
