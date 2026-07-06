import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential } from "@/lib/azure";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { serverError } from '@/lib/apiErrors';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const subscriptionId = searchParams.get('subscriptionId');
        const tagKey = searchParams.get('tagKey') || 'CostCenter';

        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId, subscriptionId" }, { status: 400 });
        }

        // Auth: validate JWT and assert caller belongs to this tenant.
        await requireTenantRole(request, tenantId, ['Admin', 'Owner', 'Reader', 'Colaborador']);

        const cacheKey = `intelligence:chargeback:${tenantId}:${subscriptionId}:${tagKey}`;

        const chargebackData = await getWithStaleWhileRevalidate(cacheKey, async () => {
            let credential;
            let client;
            try {
                credential = await getAzureCredential(tenantId);
                client = new CostManagementClient(credential);
            } catch (e: any) {
                console.warn(`[Chargeback] Sin credenciales para ${tenantId}:`, e?.message);
                return { aggregated: [], detailedCosts: [] };
            }
            const scope = subscriptionId === 'All' 
                ? `/providers/Microsoft.Management/managementGroups/${tenantId}` 
                : `/subscriptions/${subscriptionId}`;

            // Advanced Payload: Daily Granularity, ResourceGroup, ChargeType, and TagKey
            const parameters = {
                type: "Usage",
                timeframe: "MonthToDate",
                dataset: {
                    granularity: "Daily",
                    aggregation: {
                        totalCost: { name: "PreTaxCost", function: "Sum" }
                    },
                    grouping: [
                        { type: "Dimension", name: "ResourceGroup" },
                        { type: "Dimension", name: "ChargeType" },
                        { type: "TagKey", name: tagKey }
                    ]
                }
            };

            let result;
            let fallbackResults: any[] = [];
            let isFallback = false;

            try {
                // [KNOWN LIMITATION]: Al agrupar por "ResourceGroup" y "ChargeType" en Azure de forma nativa,
                // ciertas suscripciones (como Enterprise Agreement directas o CSP) pueden devolver errores HTTP 400
                // si la API nativa no soporta ciertas dimensiones cruzadas con etiquetas en este scope.
                // Si eso sucede o si falla por RBAC, caerá en el bloque catch inferior y usará el fallback iterativo.
                result = await client.query.usage(scope, parameters as any);
            } catch (e: any) {
                const isAuthOrNotFound = e.statusCode === 403 || e.statusCode === 401 || e.statusCode === 400 || e.code === 'AuthorizationFailed' || e.code === 'RBACAccessDenied' || e.message?.includes('AuthorizationFailed') || e.code === 'ManagementGroupNotFound' || e.message?.includes("was not found or you don't have access") || e.message?.includes('does not have authorization') || e.message?.includes('does not have any valid subscriptions');
                if (subscriptionId === 'All' && isAuthOrNotFound) {
                    isFallback = true;
                    console.log("Management Group scope failed for chargeback, falling back to concurrent subscription iteration...");
                    const token = await credential.getToken("https://management.azure.com/.default");
                    const subRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
                        headers: { 'Authorization': `Bearer ${token?.token}` }
                    });
                    const subJson = await subRes.json();
                    const subs = subJson.value || [];
                    
                    const subPromises: Promise<any>[] = [];
                    for (const sub of subs) {
                        if (sub.subscriptionId && sub.state === 'Enabled') {
                            subPromises.push(client.query.usage(`/subscriptions/${sub.subscriptionId}`, parameters as any).catch(() => null));
                        }
                    }
                    fallbackResults = (await Promise.all(subPromises)).filter(r => r && r.rows);
                } else {
                    throw e;
                }
            }

            const chargebackMap: Record<string, number> = {};
            const detailedCosts: any[] = [];

            const processRows = (res: any) => {
                if (res.rows && res.columns) {
                    const costIndex = res.columns.findIndex((c: any) => c.name === 'PreTaxCost');
                    const dateIndex = res.columns.findIndex((c: any) => c.name === 'UsageDate');
                    const rgIndex = res.columns.findIndex((c: any) => c.name === 'ResourceGroup');
                    const chargeTypeIndex = res.columns.findIndex((c: any) => c.name === 'ChargeType');
                    const tagIndex = res.columns.findIndex((c: any) => c.name === tagKey || c.name === 'TagKey');

                    if (costIndex !== -1 && tagIndex !== -1) {
                        for (const row of res.rows) {
                            const cost = row[costIndex] as number;
                            let tagValue = row[tagIndex] as string;
                            if (!tagValue || tagValue.trim() === "") {
                                tagValue = "Sin Etiquetar / Untagged";
                            }
                            
                            if (!chargebackMap[tagValue]) chargebackMap[tagValue] = 0;
                            chargebackMap[tagValue] += cost;

                            // Store detailed raw data for frontend
                            detailedCosts.push({
                                cost: cost,
                                date: dateIndex !== -1 ? row[dateIndex] : null,
                                resourceGroup: rgIndex !== -1 ? row[rgIndex] : 'Desconocido',
                                chargeType: chargeTypeIndex !== -1 ? row[chargeTypeIndex] : 'Desconocido',
                                costCenter: tagValue
                            });
                        }
                    }
                }
            };

            if (isFallback) {
                fallbackResults.forEach(res => processRows(res));
            } else {
                if (result) processRows(result);
            }

            const aggregated = Object.keys(chargebackMap).map(k => ({
                name: k,
                value: Number(chargebackMap[k].toFixed(2))
            }));

            return { aggregated, detailedCosts };
        }, 3600); // Guardar en caché por 1 hora

        return NextResponse.json({ data: chargebackData.aggregated, detailed: chargebackData.detailedCosts });

    } catch (error: any) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Chargeback Fetch Error:", error);
        return serverError(error, { message: "Fallo al obtener información de chargeback.", status: 500 });
    }
}
