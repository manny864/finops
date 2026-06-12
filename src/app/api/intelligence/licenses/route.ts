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

                const sqlResults = await Promise.all(sqls.map(async (res) => {
                    const sku = res.sku || "GP_Gen5_2";
                    const loc = res.location || "eastus";
                    const price = await getMonthlyCostEstimate("SQL Database", sku, loc);
                    const monthlyCost = price || 200.0;
                    return {
                        resourceId: res.id,
                        name: res.name,
                        type: 'microsoft.sql/servers/databases',
                        potentialLicenseSavings: parseFloat((monthlyCost * 0.4).toFixed(2)),
                        subscriptionId: res.subscriptionId,
                        resourceGroup: res.resourceGroup,
                        location: res.location
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

