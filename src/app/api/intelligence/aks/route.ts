import { NextRequest, NextResponse } from "next/server";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential, getResourceGraphClient, getSubscriptionsForTenant } from "@/lib/azure";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { withArgLimit } from "@/lib/argConcurrency";
import { resolveCostColumn, degradeCostColumn, isCostUsdUnsupportedError, findCostColumnIndex, type CostColumn } from "@/lib/azureCostColumn";
import { getAksChargebackCost } from "@/modules/collectors/azure/aksCostService";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('aks', tenantId));
        }

        const bust = request.nextUrl.searchParams.get('bust') === '1';
        const cacheKey = `aks_intelligence:v2:${tenantId}`;

        const fetcher = async () => {
            let credential;
            const clusters: any[] = [];
            try {
                credential = await getAzureCredential(tenantId);

                // 1. Inventario de clústeres AKS vía ARG con cliente optimizado.
                const argClient = await getResourceGraphClient(tenantId);
                const query = `
                    Resources
                    | where type =~ "microsoft.containerservice/managedclusters"
                    | project id, name, resourceGroup, subscriptionId, location, nodeResourceGroup = tostring(properties.nodeResourceGroup)
                `;

                const r: any = await withArgLimit(() => argClient.resources({
                    query,
                    options: { resultFormat: "objectArray", top: 1000 }
                }));
                if (Array.isArray(r?.data)) clusters.push(...r.data);
            } catch (e: any) {
                console.warn(`[AKS] No se pudo listar clústeres para ${tenantId}:`, e?.message);
                return [];
            }

            if (clusters.length === 0) return [];

            // 2. Costos por (subscriptionId, resourceGroup) — clave compuesta para evitar
            //    colisiones cross-sub (mismo nombre de RG en distintas subs).
            const costClient = new CostManagementClient(credential);
            const scope = `/providers/Microsoft.Management/managementGroups/${tenantId}`;

            // Clave: `${subId}::${rgLower}` -> cost
            const rgCosts: Record<string, number> = {};
            // Costo específico del control plane AKS (Uptime SLA), keyed por resourceId del cluster.
            const aksServiceCostByResourceId: Record<string, number> = {};

            // CostUSD (normalizado a USD por Azure) en vez de PreTaxCost (moneda
            // de facturación de la suscripción) — ver src/lib/azureCostColumn.ts.
            let activeCol: CostColumn = await resolveCostColumn(tenantId);

            try {
                const buildRgCostQuery = (col: CostColumn) => ({
                    type: "Usage",
                    timeframe: "MonthToDate",
                    dataset: {
                        granularity: "None",
                        aggregation: { totalCost: { name: col, function: "Sum" } },
                        grouping: [
                            { type: "Dimension", name: "ResourceGroupName" },
                            { type: "Dimension", name: "SubscriptionId" }
                        ]
                    }
                });
                let costRes: any;
                try {
                    costRes = await costClient.query.usage(scope, buildRgCostQuery(activeCol));
                } catch (colErr: any) {
                    if (activeCol === 'CostUSD' && isCostUsdUnsupportedError(colErr)) {
                        console.warn(`[AKS] CostUSD no soportado para tenant ${tenantId} — degradando a PreTaxCost.`);
                        await degradeCostColumn(tenantId);
                        activeCol = 'PreTaxCost';
                        costRes = await costClient.query.usage(scope, buildRgCostQuery(activeCol));
                    } else {
                        throw colErr;
                    }
                }

                if (costRes.rows && costRes.columns) {
                    const colIdx = (name: string) => costRes.columns!.findIndex((c: any) => String(c.name).toLowerCase() === name.toLowerCase());
                    const iCost = findCostColumnIndex(costRes.columns) >= 0 ? findCostColumnIndex(costRes.columns) : 0;
                    const iRg = colIdx("ResourceGroupName") >= 0 ? colIdx("ResourceGroupName") : 1;
                    const iSub = colIdx("SubscriptionId") >= 0 ? colIdx("SubscriptionId") : 2;
                    costRes.rows.forEach((row: any[]) => {
                        const cost = Number(row[iCost]) || 0;
                        const rg = String(row[iRg] || "").toLowerCase();
                        const sub = String(row[iSub] || "").toLowerCase();
                        if (rg && sub) rgCosts[`${sub}::${rg}`] = (rgCosts[`${sub}::${rg}`] || 0) + cost;
                    });
                }
            } catch (costError: any) {
                console.warn("[AKS] Sin permiso para costos a nivel Management Group:", costError?.message);
            }

            // Fallback a nivel de Suscripción / ResourceGroup si el Management Group no devolvió costos
            const missingCosts = clusters.filter(c => {
                const subLower = (c.subscriptionId || "").toLowerCase();
                const nodeRgLower = (c.nodeResourceGroup || "").toLowerCase();
                return !(rgCosts[`${subLower}::${nodeRgLower}`] > 0);
            });

            if (missingCosts.length > 0) {
                for (const cl of missingCosts) {
                    if (!cl.subscriptionId || !cl.nodeResourceGroup) continue;
                    const subLower = cl.subscriptionId.toLowerCase();
                    const nodeRgLower = cl.nodeResourceGroup.toLowerCase();
                    const rgScope = `/subscriptions/${cl.subscriptionId}/resourceGroups/${cl.nodeResourceGroup}`;
                    try {
                        const directRes: any = await costClient.query.usage(rgScope, {
                            type: "Usage",
                            timeframe: "MonthToDate",
                            dataset: {
                                granularity: "None",
                                aggregation: { totalCost: { name: activeCol, function: "Sum" } }
                            }
                        });
                        if (directRes?.rows?.length > 0) {
                            const val = Number(directRes.rows[0][0]) || 0;
                            if (val > 0) {
                                rgCosts[`${subLower}::${nodeRgLower}`] = val;
                            }
                        }
                    } catch (directErr: any) {
                        console.warn(`[AKS] Fallback de costo en RG ${cl.nodeResourceGroup} falló:`, directErr?.message);
                    }
                }
            }

            // Costo SOLO del servicio AKS (control plane / Uptime SLA), aislado del resto del RG principal.
            try {
                const buildAksOnlyQuery = (col: CostColumn) => ({
                    type: "Usage",
                    timeframe: "MonthToDate",
                    dataset: {
                        granularity: "None",
                        aggregation: { totalCost: { name: col, function: "Sum" } },
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
                let aksOnly: any;
                try {
                    aksOnly = await costClient.query.usage(scope, buildAksOnlyQuery(activeCol));
                } catch (colErr: any) {
                    if (activeCol === 'CostUSD' && isCostUsdUnsupportedError(colErr)) {
                        console.warn(`[AKS] CostUSD no soportado (control plane) para tenant ${tenantId} — degradando a PreTaxCost.`);
                        await degradeCostColumn(tenantId);
                        activeCol = 'PreTaxCost';
                        aksOnly = await costClient.query.usage(scope, buildAksOnlyQuery(activeCol));
                    } else {
                        throw colErr;
                    }
                }

                if (aksOnly.rows && aksOnly.columns) {
                    const colIdx = (name: string) => aksOnly.columns!.findIndex((c: any) => String(c.name).toLowerCase() === name.toLowerCase());
                    const iCost = findCostColumnIndex(aksOnly.columns) >= 0 ? findCostColumnIndex(aksOnly.columns) : 0;
                    const iRid = colIdx("ResourceId") >= 0 ? colIdx("ResourceId") : 1;
                    aksOnly.rows.forEach((row: any[]) => {
                        const cost = Number(row[iCost]) || 0;
                        const rid = String(row[iRid] || "").toLowerCase();
                        if (rid) aksServiceCostByResourceId[rid] = (aksServiceCostByResourceId[rid] || 0) + cost;
                    });
                }
            } catch (e: any) {
                console.warn("[AKS] No se pudo aislar el costo del control plane:", e?.message);
            }

            // 3. Cruce: nodeRG (VMSS, discos, LBs) + costo del propio cluster (control plane).
            const finalData = await Promise.all(clusters.map(async (cluster: any) => {
                const subLower = (cluster.subscriptionId || "").toLowerCase();
                const nodeRgLower = (cluster.nodeResourceGroup || "").toLowerCase();
                const idLower = (cluster.id || "").toLowerCase();

                let nodeRgCost = nodeRgLower && subLower ? (rgCosts[`${subLower}::${nodeRgLower}`] || 0) : 0;
                let controlPlaneCost = aksServiceCostByResourceId[idLower] || 0;
                let totalCost = nodeRgCost + controlPlaneCost;

                // Si Cost Management aún no tiene consolidada la facturación MTD (0.00),
                // consultar el motor de inferencia de AKS Chargeback para reflejar la capacidad y costos del clúster
                if (totalCost === 0 && cluster.nodeResourceGroup && cluster.subscriptionId) {
                    try {
                        const cbData = await getAksChargebackCost(tenantId, cluster.subscriptionId, cluster.name, cluster.nodeResourceGroup);
                        if (cbData && cbData.totalClusterCost > 0) {
                            totalCost = cbData.totalClusterCost;
                            controlPlaneCost = cbData.hiddenCosts?.controlPlaneCost || 0;
                            nodeRgCost = Math.max(0, Number((totalCost - controlPlaneCost).toFixed(2)));
                        }
                    } catch (cbErr: any) {
                        console.warn("[AKS] Fallback de costo vía Chargeback falló:", cbErr?.message);
                    }
                }

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
                    hasCostData: totalCost > 0
                };
            }));

            return finalData.sort((a: any, b: any) => b.totalCost - a.totalCost);
        };

        const data = bust
            ? await fetcher()
            : await getWithStaleWhileRevalidate(cacheKey, fetcher, 1800, 600);

        return NextResponse.json({ success: true, data });

    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("AKS Intelligence Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
