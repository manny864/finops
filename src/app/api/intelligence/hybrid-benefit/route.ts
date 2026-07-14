import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { hasAccess } from "@/lib/tierLogic";
import { tenants as mockTenants } from "@/lib/tenants";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { getResourceGraphClient } from "@/lib/azure";
import { getRetailPricing } from "@/services/pricingService";
import pool from "@/modules/storage/db";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        await requireTenantAccess(request, tenantId);

        // Tier resuelto desde DB/lista de mocks, no del query param del cliente
        // (antes ?tier=Professional en la URL bypasseaba el paywall).
        let userTier = 'Essential';
        if (isMockTenant(tenantId)) {
            userTier = mockTenants.find(t => t.id === tenantId)?.tier || 'Essential';
        } else {
            const [tierRows] = await pool.query("SELECT tier FROM Tenants WHERE tenant_id = ? LIMIT 1", [tenantId]);
            if (Array.isArray(tierRows) && tierRows.length > 0) {
                userTier = (tierRows[0] as { tier?: string }).tier || 'Essential';
            }
        }

        // Feature Gating
        if (!hasAccess(userTier, 'Professional')) {
            return NextResponse.json({ error: "Funcionalidad requiere plan Professional o superior." }, { status: 403 });
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute('hybrid-benefit', tenantId));
        }

        // Real Data fetching using Cache and Azure Resource Graph (ARG)
        const cacheKey = `hybrid-benefit:${tenantId}`;
        const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
            let client;
            let resources: any[];
            try {
                client = await getResourceGraphClient(tenantId);

                // VMs: Windows OS sin AHB habilitado (licenseType no es 'Windows_Server')
                // SQL DBs: Sin AHB habilitado (licenseType no es 'BasePrice')
                const query = `
                    Resources
                    | where (
                        type =~ 'microsoft.compute/virtualmachines' 
                        and properties.storageProfile.osDisk.osType =~ 'Windows' 
                        and (isnull(properties.licenseType) or properties.licenseType != 'Windows_Server')
                      ) or (
                        type =~ 'microsoft.sql/servers/databases' 
                        and name != 'master' 
                        and properties.licenseType != 'BasePrice'
                      )
                    | project id, name, type, location, skuName = tostring(coalesce(properties.hardwareProfile.vmSize, sku.name))
                `;

                const response = await client.resources({ query });
                resources = (response.data as any[]) || [];
            } catch (e: any) {
                console.warn(`[HybridBenefit] Sin credenciales/acceso para ${tenantId}:`, e?.message);
                return { totalPotentialSavings: 0, eligibleResources: [] };
            }

            const eligibleResources = [];
            let totalPotentialSavings = 0;

            for (const res of resources) {
                let serviceName = '';
                let typeLabel = '';
                if (res.type.toLowerCase() === 'microsoft.compute/virtualmachines') {
                    serviceName = 'Virtual Machines';
                    typeLabel = 'Windows VM';
                } else {
                    serviceName = 'SQL Database';
                    typeLabel = 'SQL Database';
                }

                // Obtener precios
                const pricing = await getRetailPricing(res.location, res.skuName, serviceName);
                
                const monthlyCostCurrent = (pricing.paygWithLicense || pricing.payg) * 730;
                const monthlyCostAHB = pricing.payg * 730;
                const savings = monthlyCostCurrent - monthlyCostAHB;

                if (savings > 0) {
                    eligibleResources.push({
                        id: res.id,
                        name: res.name,
                        type: typeLabel,
                        currentCost: monthlyCostCurrent,
                        ahbCost: monthlyCostAHB,
                        savings: savings
                    });
                    totalPotentialSavings += savings;
                }
            }

            return {
                totalPotentialSavings,
                eligibleResources
            };
        }, 86400); // 24 hours TTL

        return NextResponse.json({ success: true, data });

    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Hybrid Benefit API Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
