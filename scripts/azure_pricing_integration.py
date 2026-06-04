import os
import re

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def update_sop():
    sop_path = os.path.join(base_dir, "directivas/azure_pricing_SOP.md")
    with open(sop_path, "w") as f:
        f.write("# Azure Retail Prices Integration SOP\\n\\n")
        f.write("- **Servicio Externo**: Utilizamos la API oficial `https://prices.azure.com/api/retail/prices`.\\n")
        f.write("- **Caché Crítico**: La API de retail es pública pero estricta. Todo `fetch` se enruta mediante `pricingService.ts` que almacena una caché en memoria local (Map) basada en `serviceName-skuName-region`.\\n")
        f.write("- **Cálculo**: Multiplicamos el `retailPrice` por 730 horas para obtener la estimación mensual en `estimatedMonthlyCost`.\\n")
    print("SOP created.")

def update_kql():
    kql_path = os.path.join(base_dir, "src/lib/kqlCatalog.ts")
    with open(kql_path, "r") as f:
        content = f.read()

    # Add sku=sku.name to unusedIps if not present
    old_ip = r"unusedIps: `Resources \| where type =~ 'microsoft.network/publicipaddresses' \| where properties.ipConfiguration == '' or isnull\(properties.ipConfiguration\) \| project id, name, location, resourceGroup, subscriptionId`"
    new_ip = "unusedIps: `Resources | where type =~ 'microsoft.network/publicipaddresses' | where properties.ipConfiguration == '' or isnull(properties.ipConfiguration) | project id, name, location, resourceGroup, subscriptionId, sku=sku.name`"
    
    content = re.sub(old_ip, new_ip, content)
    
    with open(kql_path, "w") as f:
        f.write(content)
    print("KQL Catalog updated.")

def create_pricing_service():
    svc_path = os.path.join(base_dir, "src/services/pricingService.ts")
    content = """// Servicio de precios de Azure Retail API con caché en memoria
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
"""
    with open(svc_path, "w") as f:
        f.write(content)
    print("Pricing service created.")

def update_audit_route():
    api_path = os.path.join(base_dir, "src/app/api/audit/full/route.ts")
    with open(api_path, "r") as f:
        content = f.read()

    # Inject Import
    if "pricingService" not in content:
        content = content.replace(
            'import { runGraphAudits, runMonitorAudits, runM365Audits } from "@/services/auditService";',
            'import { runGraphAudits, runMonitorAudits, runM365Audits } from "@/services/auditService";\\nimport { getMonthlyCostEstimate } from "@/services/pricingService";'
        )

    # Inject processing block after graphResults
    injection_marker = "const graphResults = await runGraphAudits(resourceGraphClient, credential, subscriptionId || undefined);"
    injection_code = """const graphResults = await runGraphAudits(resourceGraphClient, credential, subscriptionId || undefined);
    
    // Interceptar para estimación de costos en huérfanos
    if (graphResults.unattachedDisks && Array.isArray(graphResults.unattachedDisks)) {
        await Promise.all(graphResults.unattachedDisks.map(async (disk: any) => {
            const sku = disk.sku || "Standard_HDD";
            const loc = disk.location || "eastus";
            const cost = await getMonthlyCostEstimate("Storage", sku, loc);
            disk.estimatedMonthlyCost = cost;
        }));
    }

    if (graphResults.unusedIps && Array.isArray(graphResults.unusedIps)) {
        await Promise.all(graphResults.unusedIps.map(async (ip: any) => {
            const sku = ip.sku || "Standard";
            const loc = ip.location || "eastus";
            const cost = await getMonthlyCostEstimate("Virtual Network", sku, loc);
            ip.estimatedMonthlyCost = cost;
        }));
    }"""

    if "estimatedMonthlyCost" not in content:
        content = content.replace(injection_marker, injection_code)

    with open(api_path, "w") as f:
        f.write(content)
    print("Audit route updated.")

if __name__ == "__main__":
    update_sop()
    update_kql()
    create_pricing_service()
    update_audit_route()
    print("All tasks completed.")
