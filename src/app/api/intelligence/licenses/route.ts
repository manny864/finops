import { NextRequest, NextResponse } from 'next/server';
import { getTenantLicensesAndInactiveUsers } from '@/services/licenseService';
import { getResourceGraphClient, getAzureCredential, getSubscriptionsForTenant } from '@/lib/azure';
import { kqlCatalog } from '@/modules/core/kqlCatalog';
import { getMonthlyCostEstimate } from '@/services/pricingService';

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.headers.get('x-tenant-id');

        if (!tenantId || tenantId === 'default') {
            return NextResponse.json({ error: 'Faltan credenciales del entorno' }, { status: 400 });
        }

        // 1. Fetch M365 Licenses (Graph API) defensively
        let licenses: any[] = [];
        let inactiveUsers: any[] = [];
        let graphError: string | null = null;
        let needsConsent = false;

        try {
            const graphData = await getTenantLicensesAndInactiveUsers(tenantId);
            licenses = graphData.licenses || [];
            inactiveUsers = graphData.inactiveUsers || [];
        } catch (error: any) {
            console.warn("Microsoft Graph API call failed for tenant:", tenantId, error.message);
            const errMsg = error.message || 'Permisos insuficientes en Microsoft Graph.';
            graphError = errMsg;
            if (errMsg.includes('403')) {
                needsConsent = true;
            }
        }

        // 2. Query Azure Resource Graph for missing AHUB resources
        let missingAhub: any[] = [];
        try {
            const credential = await getAzureCredential(tenantId);
            const client = await getResourceGraphClient(tenantId);
            const subs = await getSubscriptionsForTenant(tenantId, credential);

            if (subs.length > 0) {
                const [vmsResponse, sqlResponse] = await Promise.all([
                    client.resources({ query: kqlCatalog.missingAhubWindowsVMs, subscriptions: subs }),
                    client.resources({ query: kqlCatalog.missingAhubSql, subscriptions: subs })
                ]);

                const vms = (vmsResponse.data || []) as any[];
                const sqls = (sqlResponse.data || []) as any[];

                const vmResults = await Promise.all(vms.map(async (res) => {
                    const sku = res.sku || "Standard_D2s_v3";
                    const loc = res.location || "eastus";
                    const price = await getMonthlyCostEstimate("Virtual Machines", sku, loc);
                    const monthlyCost = price || 150.0;
                    // AHUB Windows Server ~ahorra 40% del compute Windows respecto a PAYG.
                    return {
                        resourceId: res.id,
                        name: res.name,
                        type: 'microsoft.compute/virtualmachines',
                        potentialLicenseSavings: parseFloat((monthlyCost * 0.4).toFixed(2)),
                        subscriptionId: res.subscriptionId,
                        resourceGroup: res.resourceGroup,
                        location: res.location
                    };
                }));

                // --- SQL: deduplicar por elastic pool / servidor ---
                // AHUB en Azure SQL se factura a nivel pool (no por base individual). Si N bases
                // comparten un pool, el ahorro AHUB es UNO solo correspondiente al pool, no N.
                // Para bases standalone (vCore Single DB), cada una sí cuenta individualmente.
                const sqlGroups = new Map<string, any[]>();
                for (const db of sqls) {
                    // Clave de agrupación: si tiene elasticPool, usar pool; si no, base standalone (clave única)
                    const groupKey = db.elasticPoolId && db.elasticPoolId.trim().length > 0
                        ? `pool::${db.elasticPoolId.toLowerCase()}`
                        : `db::${db.id.toLowerCase()}`;
                    if (!sqlGroups.has(groupKey)) sqlGroups.set(groupKey, []);
                    sqlGroups.get(groupKey)!.push(db);
                }

                const sqlResults = await Promise.all(Array.from(sqlGroups.entries()).map(async ([groupKey, dbs]) => {
                    const representative = dbs[0];
                    const isPool = groupKey.startsWith('pool::');
                    const sku = representative.sku || "GP_Gen5_2";
                    const loc = representative.location || "eastus";
                    const price = await getMonthlyCostEstimate("SQL Database", sku, loc);
                    // Si el pricing API no respondió, usamos un estimado conservador por vCore
                    // (capacity ~ vCores en vCore tiers). Default mínimo razonable.
                    const fallbackPerVCore = 70; // USD/mes por vCore (vCore GP P3 aprox sin AHUB)
                    const vCores = Number(representative.capacity) || 2;
                    const monthlyCost = price || (fallbackPerVCore * vCores);
                    // AHUB Azure SQL ahorra ~30% sobre vCore License-Included (no 40% del costo total).
                    const ahubSavings = parseFloat((monthlyCost * 0.30).toFixed(2));
                    return {
                        resourceId: isPool ? representative.elasticPoolId : representative.id,
                        name: isPool ? `Elastic Pool (${dbs.length} DBs)` : representative.name,
                        type: 'microsoft.sql/servers/databases',
                        potentialLicenseSavings: ahubSavings,
                        subscriptionId: representative.subscriptionId,
                        resourceGroup: representative.resourceGroup,
                        location: representative.location,
                        scope: isPool ? 'elasticPool' : 'singleDatabase',
                        databaseCount: dbs.length,
                        tier: representative.tier,
                        vCores
                    };
                }));

                missingAhub = [...vmResults, ...sqlResults];
            }
        } catch (argError: any) {
            console.error("Azure Resource Graph AHUB query failed:", argError);
        }

        return NextResponse.json({
            success: true,
            data: {
                licenses,
                inactiveUsers,
                missingAhub,
                graphError,
                needsConsent
            }
        });
    } catch (error: any) {
        console.error("License API error:", error);
        return NextResponse.json({ success: false, error: error.message || 'Error del servidor' }, { status: 500 });
    }
}

