import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { runGraphAudits } from "@/services/auditService";
import { getMonthlyCostEstimate } from "@/services/pricingService";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { getExemptionsForTenant } from "@/modules/storage/recommendationExemptions";

async function queryResourceGraphWithRetry(client: any, query: string, subscriptions: string[], retries = 3, initialDelay = 3000): Promise<any> {
    let currentDelay = initialDelay;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await client.resources({ query, subscriptions });
        } catch (e: any) {
            const isRateLimit = e.statusCode === 429 || (e.code && e.code === 'RateLimiting');
            if (isRateLimit && attempt < retries) {
                console.warn(`[Zombies API] Rate Limited (429). Retrying query in ${currentDelay}ms... (Attempt ${attempt}/${retries})`);
                await new Promise(resolve => setTimeout(resolve, currentDelay));
                currentDelay *= 1.5;
            } else {
                throw e;
            }
        }
    }
}

async function attachZombieExemptions<T extends { resourceId?: string; id?: string }>(tenantId: string, items: T[]): Promise<T[]> {
    const exemptions = await getExemptionsForTenant(tenantId);
    const exemptionsMap = new Map(
        exemptions
            .filter((e) => e.recommendationType === "zombies")
            .map((e) => [(e.resourceId || "").toLowerCase(), e])
    );

    return items.map((item: any) => {
        const ex = exemptionsMap.get((item.resourceId || item.id || "").toLowerCase()) as any;
        if (!ex) {
            return { ...item, isExempted: false, exemptionReason: null, exemptionComment: null };
        }
        return {
            ...item,
            isExempted: true,
            exemptionReason: ex.reason || null,
            exemptionComment: ex.comment || null,
        };
    });
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const subscriptionId = searchParams.get('subscriptionId');
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

    const cacheKey = `cleanup:zombies:v2:azure:${tenantId}:${subscriptionId || 'all'}`;
    const fetcher = () => fetchZombies(tenantId, subscriptionId);
    const allZombies = await getWithStaleWhileRevalidate(cacheKey, fetcher, 1800, 600);
    const allZombiesWithExemptions = await attachZombieExemptions(tenantId, allZombies);

    return NextResponse.json({ success: true, data: allZombiesWithExemptions });

  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(`[Zombies API] ERROR:`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function fetchZombies(tenantId: string, subscriptionId: string | null): Promise<any[]> {
    // 2. Obtener Cliente Autenticado
    const credential = await getAzureCredential(tenantId);
    const resourceGraphClient = new ResourceGraphClient(credential);

    // 3. Obtener suscripciones autorizadas
    let subs: string[] = [];
    if (subscriptionId && subscriptionId.toLowerCase() !== 'all') {
        subs = [subscriptionId];
    } else {
        subs = await getSubscriptionsForTenant(tenantId, credential);
    }

    if (subs.length === 0) {
        return [];
    }

    // 4. Ejecutar Auditoría Graph y consulta de Discos en paralelo
    const disksQuery = `
        Resources
        | where type =~ 'microsoft.compute/disks'
        | project id = tolower(id), diskSizeGB = toint(properties.diskSizeGB), sku = sku.name, location
    `;

    const graphResults = await runGraphAudits(resourceGraphClient, credential, subscriptionId || undefined);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const disksResponse = await queryResourceGraphWithRetry(resourceGraphClient, disksQuery, subs);

    // Build disk details lookup map
    const disksMap = new Map<string, { sizeGB: number, sku: string, location: string }>();
    const disksData = disksResponse.data as any[] || [];
    for (const d of disksData) {
        if (d.id) {
            disksMap.set(d.id.toLowerCase(), {
                sizeGB: d.diskSizeGB || 0,
                sku: d.sku || "Standard_LRS",
                location: d.location || "eastus"
            });
        }
    }

    // Define keys of interest for Enterprise Zombies
    const targets = [
        "unattachedDisks",
        "unattachedPublicIps",
        "unattachedNics",
        "emptyAppServicePlans",
        "unusedVNetGateways",
        "unusedLoadBalancers",
        "unusedAppGateways",
        "emptySqlElasticPools",
        "idleVmss",
        "oldSnapshots",
        "longStoppedVMs",
        "emptyRgs"
    ];

    const allZombies: any[] = [];

    // Process targets concurrently
    await Promise.all(targets.map(async (key) => {
        const items = graphResults[key] || [];
        if (!Array.isArray(items)) return;

        await Promise.all(items.map(async (res: any) => {
            let cost = 0;
            let typeLabel = res.type || "unknown";

            switch (key) {
                case "unattachedDisks":
                    {
                        const sku = res.sku || "Standard_HDD";
                        const loc = res.location || "eastus";
                        const price = await getMonthlyCostEstimate("Storage", sku, loc);
                        cost = price || (res.diskSizeGB ? res.diskSizeGB * 0.15 : 15.0);
                        typeLabel = "microsoft.compute/disks";
                    }
                    break;
                case "unattachedPublicIps":
                    {
                        const sku = res.sku || "Standard";
                        const loc = res.location || "eastus";
                        const price = await getMonthlyCostEstimate("Virtual Network", sku, loc);
                        cost = price || 3.5;
                        typeLabel = "microsoft.network/publicipaddresses";
                    }
                    break;
                case "unattachedNics":
                    cost = 0;
                    typeLabel = "microsoft.network/networkinterfaces";
                    break;
                case "emptyAppServicePlans":
                    {
                        const sku = res.sku || "S1";
                        const loc = res.location || "eastus";
                        const price = await getMonthlyCostEstimate("App Service", sku, loc);
                        if (price) {
                            cost = price;
                        } else {
                            const skuUpper = sku.toUpperCase();
                            if (skuUpper.startsWith("P")) cost = 150.0;
                            else if (skuUpper.startsWith("S")) cost = 75.0;
                            else if (skuUpper.startsWith("B")) cost = 55.0;
                            else if (skuUpper.startsWith("D") || skuUpper.startsWith("F")) cost = 0.0;
                            else cost = 45.0;
                        }
                        typeLabel = "microsoft.web/serverfarms";
                    }
                    break;
                case "unusedVNetGateways":
                    cost = 130.0;
                    typeLabel = "microsoft.network/virtualnetworkgateways";
                    break;
                case "unusedLoadBalancers":
                    cost = 18.0;
                    typeLabel = "microsoft.network/loadbalancers";
                    break;
                case "unusedAppGateways":
                    {
                        // El costo real varía por tier/capacity units; usamos un
                        // piso conservador por tier cuando no hay pricing exacto.
                        const tier = String(res.tier || res.sku || "").toLowerCase();
                        if (tier.includes("waf_v2") || tier.includes("wafv2")) cost = 330.0;
                        else if (tier.includes("_v2") || tier.includes("v2")) cost = 250.0;
                        else if (tier.includes("waf")) cost = 200.0;
                        else cost = 130.0;
                        typeLabel = "microsoft.network/applicationgateways";
                    }
                    break;
                case "emptySqlElasticPools":
                    {
                        // El costo depende del tier/DTU-vCore; piso conservador.
                        const sku = String(res.sku || res.tier || "").toLowerCase();
                        if (sku.includes("premium") || sku.includes("businesscritical")) cost = 400.0;
                        else if (sku.includes("standard") || sku.includes("generalpurpose")) cost = 150.0;
                        else cost = 100.0;
                        typeLabel = "microsoft.sql/servers/elasticpools";
                    }
                    break;
                case "idleVmss":
                    // Escalado a 0 instancias: sin costo de cómputo, flag de gobernanza.
                    cost = 0;
                    typeLabel = "microsoft.compute/virtualmachinescalesets";
                    break;
                case "oldSnapshots":
                    cost = (res.sizeGB || 50) * 0.05;
                    typeLabel = "microsoft.compute/snapshots";
                    break;
                case "longStoppedVMs":
                    {
                        let storageCost = 0;
                        const attachedDiskIds: string[] = [];
                        if (res.osDiskId) attachedDiskIds.push(res.osDiskId.toLowerCase());
                        if (res.dataDisks && Array.isArray(res.dataDisks)) {
                            for (const d of res.dataDisks) {
                                if (d.managedDisk?.id) {
                                    attachedDiskIds.push(d.managedDisk.id.toLowerCase());
                                }
                            }
                        }
                        for (const diskId of attachedDiskIds) {
                            const diskInfo = disksMap.get(diskId);
                            if (diskInfo) {
                                const price = await getMonthlyCostEstimate("Storage", diskInfo.sku, diskInfo.location || res.location || "eastus");
                                storageCost += price || (diskInfo.sizeGB * 0.15);
                            }
                        }
                        cost = parseFloat(storageCost.toFixed(2));
                        typeLabel = "microsoft.compute/virtualmachines";
                    }
                    break;
                case "emptyRgs":
                    cost = 0;
                    typeLabel = "microsoft.resources/subscriptions/resourcegroups";
                    break;
            }

            allZombies.push({
                resourceId: res.id,
                name: res.name,
                resourceType: typeLabel,
                monthlyCost: cost,
                // Additional legacy fields for UI rendering support
                id: res.id,
                type: typeLabel,
                resourceGroup: res.resourceGroup,
                subscriptionId: res.subscriptionId || subscriptionId || "all",
                estimatedMonthlyCost: cost,
                powerState: res.powerState,
                isHygiene: key === "emptyRgs",
                reason: key === "emptyRgs" ? "Grupo de recursos vacío" : undefined
            });
        }));
    }));

    return allZombies;
}
