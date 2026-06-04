// Servicio de precios de Azure Retail API con caché en memoria
const priceCache = new Map<string, number>();

export async function getMonthlyCostEstimate(serviceName: string, skuName: string, region: string): Promise<number> {
    if (!skuName || !region || !serviceName) return 0;
    
    const cacheKey = `${serviceName}-${skuName}-${region}`.toLowerCase();
    
    if (priceCache.has(cacheKey)) {
        return priceCache.get(cacheKey)!;
    }

    try {
        const filter = `serviceName eq '${serviceName}' and armRegionName eq '${region}' and skuName eq '${skuName}' and priceType eq 'Consumption'`;
        const url = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter)}`;
        
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`Pricing API failed for ${cacheKey}: ${res.status}`);
            return 0;
        }

        const data = await res.json();
        if (data && data.Items && data.Items.length > 0) {
            const retailPrice = data.Items[0].retailPrice || 0;
            const monthlyCost = retailPrice * 730;
            priceCache.set(cacheKey, monthlyCost);
            return monthlyCost;
        }
        
        // Cachear a 0 si no se encontró resultado para no martillar la API
        priceCache.set(cacheKey, 0);
        return 0;

    } catch (e) {
        console.error(`Error fetching price for ${cacheKey}:`, e);
        return 0;
    }
}
