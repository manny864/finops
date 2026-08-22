/**
 * GET / POST / DELETE /api/cleanup/zombies
 * Motor Omni-Scan de Auditoría y Remediación de Recursos Zombis (Hard Waste vs Soft Waste)
 *
 * RBAC: isMockTenant evaluado ANTES de requireTenantAccess.
 * En tenants reales: requireTenantAccess / requireTenantRole y tolerancia cero a fallbacks mock.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { runGraphAudits } from "@/services/auditService";
import { getMonthlyCostEstimate } from "@/services/pricingService";
import { requireTenantAccess, requireTenantRole, AuthError } from "@/lib/requestAuth";
import { getWithStaleWhileRevalidate, invalidateCache } from "@/lib/cache";
import { isMockTenant } from "@/lib/mockData";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import {
  getMockZombieAuditPayload,
  assembleLiveZombieAudit,
  getZombieExemptions,
  getLocalTagsCache,
  saveZombieExemption,
  deleteZombieExemption,
  saveLocalResourceTags,
} from "@/services/azureZombieAudit.service";
import { ZombieExemptionPayload } from "@/types/azureZombieAudit.types";

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

async function scanLiveZombiesFromARG(tenantId: string, subscriptionId?: string | null): Promise<any[]> {
  try {
    const credential = await getAzureCredential(tenantId);
    const resourceGraphClient = new ResourceGraphClient(credential);

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
      runGraphAudits(resourceGraphClient, credential, subscriptionId || undefined),
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
                const price = await getMonthlyCostEstimate("Storage", sku, loc);
                cost = price || (res.diskSizeGB ? res.diskSizeGB * 0.15 : 15.0);
                typeLabel = "microsoft.compute/disks";
                break;
              }
              case "unattachedPublicIps": {
                const sku = res.sku || "Standard";
                const loc = res.location || "eastus";
                const price = await getMonthlyCostEstimate("Virtual Network", sku, loc);
                cost = price || 3.5;
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
                    const price = await getMonthlyCostEstimate(
                      "Storage",
                      diskInfo.sku,
                      diskInfo.location || res.location || "eastus"
                    );
                    storageCost += price || diskInfo.sizeGB * 0.15;
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
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();
    const searchParams = request.nextUrl.searchParams;
    const subscriptionId = searchParams.get("subscriptionId");
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    if (isMockTenant(tenantId)) {
      const mockPayload = getMockZombieAuditPayload(tenantId);
      return NextResponse.json({
        success: true,
        data: mockPayload.metrics.resources,
        metrics: mockPayload.metrics,
        source: "mock",
        lastUpdated: mockPayload.lastUpdated,
      });
    }

    await requireTenantAccess(request, tenantId);

    const cacheKey = `cleanup:zombies:v5:${tenantId}:${subscriptionId || "all"}`;
    const rawItems = await getWithStaleWhileRevalidate(
      cacheKey,
      () => scanLiveZombiesFromARG(tenantId, subscriptionId),
      900,
      300
    );

    const [exemptions, localTags] = await Promise.all([
      getZombieExemptions(tenantId),
      getLocalTagsCache(tenantId),
    ]);

    const assembled = assembleLiveZombieAudit({
      rawItems,
      exemptions,
      localTags,
    });

    return NextResponse.json({
      success: true,
      data: assembled.metrics.resources,
      metrics: assembled.metrics,
      source: "live",
      lastUpdated: assembled.lastUpdated,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Zombies API] GET error:", errorMessage(error));
    return NextResponse.json(
      { error: "Error interno procesando auditoría de zombis" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await initializeDatabase();
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    const isMock = isMockTenant(tenantId);
    let userEmail = "admin@demo.local";

    if (!isMock) {
      const identity = await requireTenantRole(request, tenantId, ["Admin", "Owner"]);
      userEmail = identity.email || "admin";
    }

    const body = await request.json();
    const { action } = body;

    if (action === "TAG") {
      const { resourceIds, tags } = body;
      if (!Array.isArray(resourceIds) || resourceIds.length === 0 || !tags) {
        return NextResponse.json({ error: "Faltan resourceIds o tags" }, { status: 400 });
      }

      if (!isMock) {
        await saveLocalResourceTags(tenantId, resourceIds, tags);
      }

      return NextResponse.json({
        success: true,
        message: `${resourceIds.length} recurso(s) etiquetados exitosamente`,
        appliedTags: tags,
      });
    }

    if (action === "EXEMPT") {
      const { resourceId, resourceName, resourceType, reason, durationDays } = body;
      if (!resourceId) {
        return NextResponse.json({ error: "Falta resourceId" }, { status: 400 });
      }

      if (!isMock) {
        await saveZombieExemption(
          tenantId,
          {
            resourceId,
            resourceName,
            resourceType,
            reason: reason || "Eximido por el usuario",
            durationDays: durationDays ? Number(durationDays) : undefined,
          },
          userEmail
        );
      }

      return NextResponse.json({
        success: true,
        message: "Recurso eximido de la auditoría zombi",
      });
    }

    if (action === "REMOVE_EXEMPTION") {
      const { resourceId } = body;
      if (!resourceId) {
        return NextResponse.json({ error: "Falta resourceId" }, { status: 400 });
      }

      if (!isMock) {
        await deleteZombieExemption(tenantId, resourceId);
      }

      return NextResponse.json({
        success: true,
        message: "Exención removida; recurso reincorporado a la auditoría",
      });
    }

    if (action === "REMEDIATE") {
      const { resourceIds } = body;
      if (!Array.isArray(resourceIds) || resourceIds.length === 0) {
        return NextResponse.json({ error: "Faltan resourceIds para remediación" }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        message: `${resourceIds.length} recurso(s) zombis programados para remediación/purga`,
        remediatedCount: resourceIds.length,
      });
    }

    return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Zombies API] POST error:", errorMessage(error));
    return NextResponse.json(
      { error: "Error procesando acción de auditoría zombi" },
      { status: 500 }
    );
  }
}
