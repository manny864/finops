import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import { hasAccess } from "@/lib/tierLogic";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { getResourceGraphClient } from "@/lib/azure";
import { getRetailPricing } from "@/services/pricingService";

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        const userTier = request.nextUrl.searchParams.get('tier') || 'Essential';

        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        // Feature Gating
        if (!hasAccess(userTier, 'Professional')) {
            return NextResponse.json({ error: "Funcionalidad requiere plan Professional o superior." }, { status: 403 });
        }

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
            return NextResponse.json(getMockDataForRoute('hybrid-benefit', tenantId));
        }

        // Real Data fetching using Cache and Azure Resource Graph (ARG)
        const cacheKey = `hybrid-benefit:${tenantId}`;
        const data = await getWithStaleWhileRevalidate(cacheKey, async () => {
            const client = await getResourceGraphClient(tenantId);
            
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
            const resources = response.data as any[];

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

    } catch (error: any) {
        console.error("Hybrid Benefit API Error:", error);
        return NextResponse.json({ error: "Fallo al generar el reporte de AHB", details: error.message }, { status: 500 });
    }
}
