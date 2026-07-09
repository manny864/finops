import { NextRequest, NextResponse } from "next/server";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { getAzureCredential } from "@/lib/azure";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { resolveCostColumn, degradeCostColumn, isCostUsdUnsupportedError, findCostColumnIndex, type CostColumn } from "@/lib/azureCostColumn";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('aks', tenantId));
        }

        const cacheKey = `aks_intelligence:${tenantId}`;
        const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
            // Adquisición de credencial + inventario de clústeres: si el tenant no tiene
            // Service Principal o le falta el rol Reader, degradamos a lista vacía en vez
            // de propagar un 500 opaco que rompe la tarjeta del dashboard.
            let credential;
            const clusters: any[] = [];
            try {
                credential = await getAzureCredential(tenantId);

                // 1. Inventario de clústeres AKS vía ARG con paginación completa.
                const argClient = new ResourceGraphClient(credential);
                const query = `
                    Resources
                    | where type =~ "microsoft.containerservice/managedclusters"
                    | project id, name, resourceGroup, subscriptionId, location, nodeResourceGroup = tostring(properties.nodeResourceGroup)
                `;

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

    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("AKS Intelligence Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
