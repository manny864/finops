import { ConsumptionManagementClient } from "@azure/arm-consumption";
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

export async function getReservationRecommendations(
  credential: TokenCredential,
  subscriptionId: string,
  scopeType: 'Single' | 'Shared' = 'Single',
  lookBackPeriod: 'Last7Days' | 'Last30Days' | 'Last60Days' = 'Last30Days'
) {
  try {
    const client = new ConsumptionManagementClient(credential, subscriptionId);
    const scope = `/subscriptions/${subscriptionId}`;
    
    const filter = `properties/scope eq '${scopeType}' and properties/lookBackPeriod eq '${lookBackPeriod}'`;
    
    const recommendations = [];
    for await (const rec of client.reservationRecommendations.list(scope, { filter })) {
        let anyCost = 0;
        const anyRec = rec as any;
        if (anyRec.properties?.costWithNoReservedInstances) anyCost = anyRec.properties.costWithNoReservedInstances;
        if (anyRec.costWithNoReservedInstances) anyCost = anyRec.costWithNoReservedInstances;
        if (anyRec.savings?.costWithNoReservedInstances) anyCost = anyRec.savings.costWithNoReservedInstances;
        
        // Si Azure omitió los costos (ej. Suscripción Sponsorship) o son cero, enriquecer usando Azure Retail Prices
        if (!anyCost && anyRec.sku && anyRec.location) {
            const skuStr = typeof anyRec.sku === 'string' ? anyRec.sku : anyRec.sku.name;
            const term = (anyRec.properties?.term || anyRec.term || 'P1Y') as string;
            
            const hourlyConsumption = await fetchRetailPrice(skuStr, anyRec.location, false);
            const reservationCost = await fetchRetailPrice(skuStr, anyRec.location, true, term);
            
            const hoursInYear = 8760;
            const years = (term.includes('P3Y') || term.includes('3 Years')) ? 3 : (term.includes('P5Y') ? 5 : 1);
            
            // Calculamos el Pay-As-You-Go anualizado según el término sugerido
            const paygCost = hourlyConsumption * hoursInYear * years;
            const netSavings = paygCost - reservationCost;
            
            if (!anyRec.properties) {
                anyRec.properties = {};
            }
            
            // Inyectamos las propiedades faltantes para que el UI las mapee
            anyRec.properties.costWithNoReservedInstances = paygCost;
            anyRec.properties.totalCostWithReservedInstances = reservationCost;
            anyRec.properties.netSavings = netSavings > 0 ? netSavings : 0;
        }

        recommendations.push(rec);
    }
    
    return recommendations;
  } catch (error: any) {
    console.error("Error fetching reservation recommendations:", error);
    throw new Error(error.message || "Failed to fetch recommendations");
  }
}
