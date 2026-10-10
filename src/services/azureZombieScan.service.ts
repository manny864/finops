/**
 * Escaneo en vivo de recursos zombis contra Azure Resource Graph, con su precio mensual.
 *
 * Lo comparten la pantalla de Recursos Zombis (`/api/cleanup/zombies`) y el reporte ejecutivo: el desperdicio
 * que el reporte le muestra al CFO es el mismo que la pantalla le muestra al operador. No hay ninguna tabla con
 * el resultado: sólo existe el escaneo y su caché de 15 minutos.
 */
import { getAzureCredential, getSubscriptionsForTenant, getResourceGraphClient } from "@/lib/azure";
import { runGraphAudits } from "@/services/auditService";
import { precioMensualDisco, precioMensualIpPublica, precioMensualPlanAppService } from "@/services/precioRecursoAzure";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import { errorMessage } from "@/lib/apiErrors";

/** TTL duro y blando (revalida en segundo plano) del escaneo en caché. */
export const ZOMBIE_SCAN_TTL_S = 900;
export const ZOMBIE_SCAN_SOFT_TTL_S = 300;

/** La clave de caché del escaneo: una sola definición para que quien lo lea y quien lo invalide no se desincronicen. */
export function zombieScanCacheKey(tenantId: string, subscriptionId?: string | null): string {
  return `cleanup:zombies:v5:${tenantId}:${subscriptionId || "all"}`;
}

async function queryResourceGraphWithRetry(
  client: any,
  query: string,
  subscriptions: string[],
  retries = 3,
  initialDelay = 2000
): Promise<any> {
  let currentDelay = initialDelay;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await client.resources({ query, subscriptions });
    } catch (e: any) {
      const isRateLimit = e.statusCode === 429 || (e.code && e.code === "RateLimiting");
      if (isRateLimit && attempt < retries) {
        console.warn(
          `[Zombies API] Rate Limited (429). Retrying in ${currentDelay}ms (Attempt ${attempt}/${retries})...`
        );
        await new Promise((resolve) => setTimeout(resolve, currentDelay));
        currentDelay *= 1.5;
      } else {
        throw e;
      }
    }
  }
}

/**
 * Recorre los hallazgos de Resource Graph y los cotiza. Lanza si el escaneo falla: quien lo muestre decide si un
 * fallo se ve como lista vacía (la pantalla) o como dato no disponible (el reporte).
 */
export async function scanLiveZombies(tenantId: string, subscriptionId?: string | null): Promise<any[]> {
  try {
    const credential = await getAzureCredential(tenantId);
    const resourceGraphClient = await getResourceGraphClient(tenantId, credential);

    let subs: string[] = [];
    if (subscriptionId && subscriptionId.toLowerCase() !== "all") {
      subs = [subscriptionId];
    } else {
      subs = await getSubscriptionsForTenant(tenantId, credential);
    }

    if (subs.length === 0) return [];

    const disksQuery = `
      Resources
      | where type =~ 'microsoft.compute/disks'
      | project id = tolower(id), diskSizeGB = toint(properties.diskSizeGB), sku = sku.name, location
    `;

    const [graphResults, disksResponse, subNameMap] = await Promise.all([
      runGraphAudits(resourceGraphClient, credential, tenantId, subscriptionId || undefined),
      queryResourceGraphWithRetry(resourceGraphClient, disksQuery, subs),
      getSubscriptionNameMap(tenantId, credential),
    ]);

    const disksMap = new Map<string, { sizeGB: number; sku: string; location: string }>();
    const disksData = (disksResponse.data as any[]) || [];
    for (const d of disksData) {
      if (d.id) {
        disksMap.set(d.id.toLowerCase(), {
          sizeGB: d.diskSizeGB || 0,
          sku: d.sku || "Standard_LRS",
          location: d.location || "eastus",
        });
      }
    }

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
      "emptyRgs",
    ];

    const allZombies: any[] = [];

    await Promise.all(
      targets.map(async (key) => {
        const items = graphResults[key] || [];
        if (!Array.isArray(items)) return;

        await Promise.all(
          items.map(async (res: any) => {
            let cost = 0;
            let typeLabel = res.type || "unknown";

            switch (key) {
              case "unattachedDisks": {
                const sku = res.sku || "Standard_HDD";
                const loc = res.location || "eastus";
                // `sku` es el `sku.name` de ARM (`Premium_LRS`): la Retail API publica los discos por
                // tier y tamaño (`P10 LRS`), y por eso este precio valía SIEMPRE el respaldo.
                const price = await precioMensualDisco(sku, res.diskSizeGB, loc);
                cost = price ?? (res.diskSizeGB ? res.diskSizeGB * 0.15 : 15.0);
                typeLabel = "microsoft.compute/disks";
                break;
              }
              case "unattachedPublicIps": {
                const sku = res.sku || "Standard";
                const loc = res.location || "eastus";
                // `skuName eq 'Standard'` trae la IP (0,005/h) y también el Public IP Prefix (0,006/h):
                // el helper viejo se quedaba con la primera fila, o sea que el número dependía del
                // orden en que contestaba la API.
                const price = await precioMensualIpPublica(sku, loc);
                cost = price ?? 3.5;
                typeLabel = "microsoft.network/publicipaddresses";
                break;
              }
              case "unattachedNics":
                cost = 0;
                typeLabel = "microsoft.network/networkinterfaces";
                break;
              case "emptyAppServicePlans": {
                const sku = res.sku || "S1";
                const loc = res.location || "eastus";
                // En la Retail API el servicio se llama `Azure App Service` (con `App Service` contesta
                // `Items: []`, y por eso regía SIEMPRE la tabla de abajo) y Linux y Windows son
                // medidores distintos: `reserved` sale de la KQL del plan.
                const price = await precioMensualPlanAppService(sku, loc, res.reserved);
                if (price !== null) {
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
                break;
              }
              case "unusedVNetGateways":
                cost = 130.0;
                typeLabel = "microsoft.network/virtualnetworkgateways";
                break;
              case "unusedLoadBalancers":
                cost = 18.0;
                typeLabel = "microsoft.network/loadbalancers";
                break;
              case "unusedAppGateways": {
                const tier = String(res.tier || res.sku || "").toLowerCase();
                if (tier.includes("waf_v2") || tier.includes("wafv2")) cost = 330.0;
                else if (tier.includes("_v2") || tier.includes("v2")) cost = 250.0;
                else if (tier.includes("waf")) cost = 200.0;
                else cost = 130.0;
                typeLabel = "microsoft.network/applicationgateways";
                break;
              }
              case "emptySqlElasticPools": {
                const sku = String(res.sku || res.tier || "").toLowerCase();
                if (sku.includes("premium") || sku.includes("businesscritical")) cost = 400.0;
                else if (sku.includes("standard") || sku.includes("generalpurpose")) cost = 150.0;
                else cost = 100.0;
                typeLabel = "microsoft.sql/servers/elasticpools";
                break;
              }
              case "idleVmss":
                cost = 0;
                typeLabel = "microsoft.compute/virtualmachinescalesets";
                break;
              case "oldSnapshots":
                cost = (res.sizeGB || 50) * 0.05;
                typeLabel = "microsoft.compute/snapshots";
                break;
              case "longStoppedVMs": {
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
                    // `diskInfo.sku` es el `sku.name` de ARM: ver el caso unattachedDisks.
                    const price = await precioMensualDisco(
                      diskInfo.sku,
                      diskInfo.sizeGB,
                      diskInfo.location || res.location || "eastus"
                    );
                    storageCost += price ?? diskInfo.sizeGB * 0.15;
                  }
                }
                cost = parseFloat(storageCost.toFixed(2));
                typeLabel = "microsoft.compute/virtualmachines";
                break;
              }
              case "emptyRgs":
                cost = 0;
                typeLabel = "microsoft.resources/subscriptions/resourcegroups";
                break;
            }

            const resSubId = res.subscriptionId || subscriptionId || "all";
            const resolvedSubName = resolveSubscriptionName(resSubId, subNameMap);

            allZombies.push({
              id: res.id,
              resourceId: res.id,
              name: res.name,
              type: typeLabel,
              resourceType: typeLabel,
              location: res.location || "eastus",
              resourceGroup: res.resourceGroup,
              subscriptionId: resSubId,
              subscriptionName: resolvedSubName,
              monthlyCost: cost,
              estimatedMonthlyCost: cost,
              powerState: res.powerState,
              tags: res.tags || {},
              isHygiene: key === "emptyRgs",
            });
          })
        );
      })
    );

    return allZombies;
  } catch (err) {
    console.error("[Zombies API] Error scanning ARG:", errorMessage(err));
    throw err;
  }
}
