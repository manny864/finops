import { TokenCredential } from "@azure/identity";

async function fetchRetailPrice(sku: string, location: string, isReservation: boolean, term?: string): Promise<number> {
    const termMap: any = {
        'P1Y': '1 Year',
        'P1Y (1 Year)': '1 Year',
        'P3Y': '3 Years',
        'P3Y (3 Years)': '3 Years',
        'P5Y': '5 Years'
    };
    
    let filter = `serviceName eq 'Virtual Machines' and armRegionName eq '${location}' and armSkuName eq '${sku}'`;
    if (isReservation) {
        filter += ` and priceType eq 'Reservation' and reservationTerm eq '${termMap[term || 'P1Y'] || '1 Year'}'`;
    } else {
        filter += ` and priceType eq 'Consumption'`;
    }

    try {
        const url = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter)}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data && data.Items && data.Items.length > 0) {
            return data.Items[0].retailPrice || 0;
        }
    } catch (e) {
        console.error("Retail API error:", e);
    }
    return 0;
}

import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getRetailPricing } from "./pricingService";

export async function calculateReservationSavings(credential: TokenCredential, subscriptionId: string) {
    try {
        const client = new ResourceGraphClient(credential);
        // Expand the query to include other reservation-capable resources
        const query = `
            Resources
            | where type in~ ('Microsoft.Compute/virtualMachines', 'Microsoft.Web/serverfarms', 'Microsoft.Sql/servers/databases')
            ${subscriptionId && subscriptionId !== 'All' ? `| where subscriptionId =~ '${subscriptionId}'` : ''}
            | project name, type, location, vmSize = tostring(properties.hardwareProfile.vmSize), skuName = tostring(sku.name)
        `;
        
        const result = await client.resources({ query });
        const resources = result.data as any[];
        
        const recommendations = [];
        
        // Cache per Service/Location/SKU to avoid calling API multiple times for the same resource type
        const pricingCache = new Map<string, { payg: number, paygWithLicense: number, res1y: number, res3y: number }>();

        for (const res of resources) {
            let actualSku = '';
            let serviceName = '';
            let resourceType = 'Unknown';

            const typeLower = res.type.toLowerCase();
            if (typeLower.includes('virtualmachines')) {
                actualSku = res.vmSize || res.skuName;
                serviceName = 'Virtual Machines';
                resourceType = 'Virtual Machine';
            } else if (typeLower.includes('serverfarms')) {
                actualSku = res.skuName;
                serviceName = 'Azure App Service';
                resourceType = 'App Service Plan';
            } else if (typeLower.includes('databases')) {
                actualSku = res.skuName;
                serviceName = 'SQL Database';
                resourceType = 'SQL Database';
            }

            if (!actualSku) {
                console.warn(`Resource ${res.name} (${res.type}) has no identifiable SKU.`);
                continue;
            }

            const cacheKey = `${serviceName}-${res.location}-${actualSku}`;
            let pricing = pricingCache.get(cacheKey);

            if (!pricing) {
                pricing = await getRetailPricing(res.location, actualSku, serviceName);
                pricingCache.set(cacheKey, pricing);
            }

            // If PAYG is 0, it means the API couldn't find the exact SKU match or it's a free tier. Skip reservations.
            if (!pricing.payg) continue;

            const monthlyCost = pricing.payg * 730;
            const monthlyCostLicenseIncluded = pricing.paygWithLicense * 730;
            const annualCost = monthlyCost * 12;
            
            // The Azure Retail Prices API returns the *total upfront cost* for the entire term for Reservations.
            const annualCost1Y = pricing.res1y; 
            const annualCost3Y = pricing.res3y / 3; 
            
            const savings1Y = pricing.res1y ? annualCost - annualCost1Y : 0;
            const savings3Y = pricing.res3y ? (annualCost * 3) - pricing.res3y : 0;

            // Only recommend if there's actual reservation pricing available for this SKU
            if (pricing.res1y > 0 || pricing.res3y > 0) {
                recommendations.push({
                    resourceName: res.name,
                    resourceType,
                    sku: actualSku,
                    region: res.location,
                    monthlyCost,
                    monthlyCostLicenseIncluded,
                    annualCost,
                    annualCost1Y,
                    annualCost3Y,
                    savings1Y: savings1Y > 0 ? savings1Y : 0,
                    savings3Y: savings3Y > 0 ? savings3Y : 0
                });
            }
        }
        
        return recommendations;
    } catch (error: any) {
        console.error("Error calculating reservation savings via ARG:", error);
        throw new Error(error.message || "Failed to calculate recommendations");
    }
}
