/**
 * GET / POST / DELETE /api/cleanup/zombies/networking
 * Motor de Detección de Desperdicio en Redes Cloud (Azure Networking Zombies)
 *
 * RBAC: isMockTenant evaluado ANTES de requireTenantAccess.
 * En tenants reales: requireTenantAccess y tolerancia cero a fallbacks mock.
 */

import { NextRequest, NextResponse } from "next/server";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { requireTenantAccess, requireTenantRole, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getAzureCredential } from "@/lib/azure";
import { runGraphAudits } from "@/services/auditService";
import { getMonthlyCostEstimate } from "@/services/pricingService";
import { getWithStaleWhileRevalidate, invalidateCache } from "@/lib/cache";
import { getExemptionsForTenant, upsertExemption, deleteExemption } from "@/modules/storage/recommendationExemptions";
import { getSubscriptionNameMap, resolveSubscriptionName } from "@/lib/azureSubscriptionNames";
import {
  getMockNetworkingZombiesPayload,
  computeNetworkingZombiesSummary,
} from "@/services/azureNetworkingZombies.service";
import {
  NetworkZombieResourceItem,
  PrivateEndpointDetailItem,
  NetworkZombieType,
} from "@/types/azureNetworkingZombies.types";
import { errorMessage } from "@/lib/apiErrors";

function resolveRegion(row: any): string {
  return String(row?.location || row?.region || row?.resourceLocation || "-");
}

function mapToZombieType(key: string, rawType?: string): NetworkZombieType {
  const t = String(rawType || key).toLowerCase();
  if (t.includes("virtualnetworkgateway") || key === "unusedVNetGateways") return "VPN_GATEWAY";
  if (t.includes("expressroute") || key === "unprovisionedExpressRoute") return "EXPRESSROUTE_GATEWAY";
  if (t.includes("publicip") || key === "unattachedPublicIps") return "PUBLIC_IP_UNATTACHED";
  if (t.includes("privateendpoint") || key === "privateEndpoints") return "PRIVATE_ENDPOINT_ORPHAN";
  if (t.includes("natgateway") || key === "natGateways") return "NAT_GATEWAY_EMPTY";
  if (t.includes("applicationgateway") || t.includes("firewall") || key === "unusedAppGateways" || key === "idleAzureFirewalls")
    return "APP_GATEWAY_EMPTY";
  if (t.includes("networkwatcher") || key === "networkWatchersNoFlowLogs") return "PLATFORM_WATCHER";
  return "VPN_GATEWAY";
}

async function fetchLiveNetworkingZombies(
  tenantId: string,
  subscriptionId: string | undefined
): Promise<{
  zombies: NetworkZombieResourceItem[];
  privateEndpoints: PrivateEndpointDetailItem[];
}> {
  const credential = await getAzureCredential(tenantId);
  const resourceGraphClient = new ResourceGraphClient(credential);

  const [graphResults, subNameMap] = await Promise.all([
    runGraphAudits(resourceGraphClient, credential, subscriptionId),
    getSubscriptionNameMap(tenantId, credential),
  ]);

  const zombies: NetworkZombieResourceItem[] = [];

  // 1. Application Gateways
  const unusedAppGateways = (graphResults as any)?.unusedAppGateways as any[] | undefined;
  for (const agw of unusedAppGateways || []) {
    const sku = agw.sku || "Standard_v2";
    const loc = agw.location || "eastus";
    let cost = await getMonthlyCostEstimate("Application Gateway", sku, loc).catch(() => 0);
    if (!cost) cost = 125.0;
    const subId = agw.subscriptionId || (agw.id?.split("/subscriptions/")[1] || "").split("/")[0] || "";

    zombies.push({
      id: agw.id,
      name: agw.name || agw.id?.split("/").pop() || "app-gateway",
      resourceType: "microsoft.network/applicationgateways",
      zombieType: "APP_GATEWAY_EMPTY",
      location: resolveRegion(agw),
      resourceGroup: agw.resourceGroup || (agw.id?.split("/resourceGroups/")[1] || "").split("/")[0] || "",
      subscriptionId: subId,
      subscriptionName: resolveSubscriptionName(subId, subNameMap),
      monthlyCostUSD: cost,
      detectionReason: "Sin backend pools o reglas de ruteo configuradas",
      idleDays: 30,
      isExempted: false,
    });
  }

  // 2. Bastion Hosts
  const allBastionHosts = (graphResults as any)?.allBastionHosts as any[] | undefined;
  for (const b of allBastionHosts || []) {
    const sku = String(b.sku || "Basic");
    const subId = b.subscriptionId || (b.id?.split("/subscriptions/")[1] || "").split("/")[0] || "";
    const cost = /premium/i.test(sku) ? 280.0 : /standard/i.test(sku) ? 209.0 : 137.0;

    zombies.push({
      id: b.id,
      name: b.name || b.id?.split("/").pop() || "bastion-host",
      resourceType: "microsoft.network/bastionhosts",
      zombieType: "APP_GATEWAY_EMPTY",
      location: resolveRegion(b),
      resourceGroup: b.resourceGroup || (b.id?.split("/resourceGroups/")[1] || "").split("/")[0] || "",
      subscriptionId: subId,
      subscriptionName: resolveSubscriptionName(subId, subNameMap),
      monthlyCostUSD: cost,
      detectionReason: "Validar necesidad — Bastion en ejecución continua",
      idleDays: 0,
      isExempted: false,
    });
  }

  // 3. Catálogo Plano de Recursos Zombi
  const FLAT_COST_TYPES: Array<{
    key: string;
    resourceType: string;
    zombieType: NetworkZombieType;
    monthlyCost: number;
    reason: string;
    daysIdle?: number;
  }> = [
    {
      key: "unusedLoadBalancers",
      resourceType: "microsoft.network/loadbalancers",
      zombieType: "APP_GATEWAY_EMPTY",
      monthlyCost: 18.0,
      reason: "Sin frontend IP configurado o sin backend pool asociado",
    },
    {
      key: "unusedVNetGateways",
      resourceType: "microsoft.network/virtualnetworkgateways",
      zombieType: "VPN_GATEWAY",
      monthlyCost: 130.0,
      reason: "Gateway VPN sin conexiones ni túneles IPsec activos",
    },
    {
      key: "emptyVnets",
      resourceType: "microsoft.network/virtualnetworks",
      zombieType: "VPN_GATEWAY",
      monthlyCost: 0,
      reason: "VNet sin subnets configuradas",
    },
    {
      key: "emptySubnets",
      resourceType: "microsoft.network/virtualnetworks/subnets",
      zombieType: "VPN_GATEWAY",
      monthlyCost: 0,
      reason: "Subnet sin recursos ni delegaciones asociadas",
    },
    {
      key: "unusedVirtualHubs",
      resourceType: "microsoft.network/virtualhubs",
      zombieType: "VPN_GATEWAY",
      monthlyCost: 180.0,
      reason: "Virtual WAN Hub sin conexiones a VNets",
    },
    {
      key: "unusedRouteServers",
      resourceType: "microsoft.network/virtualhubs",
      zombieType: "VPN_GATEWAY",
      monthlyCost: 216.0,
      reason: "Azure Route Server sin conexiones a VNets",
    },
    {
      key: "unprovisionedExpressRoute",
      resourceType: "microsoft.network/expressroutecircuits",
      zombieType: "EXPRESSROUTE_GATEWAY",
      monthlyCost: 300.0,
      reason: "Circuito ExpressRoute sin aprovisionar o sin peerings",
    },
    {
      key: "disconnectedVnetPeerings",
      resourceType: "microsoft.network/virtualnetworks/virtualnetworkpeerings",
      zombieType: "VPN_GATEWAY",
      monthlyCost: 0,
      reason: "Peering en estado distinto de Connected",
    },
    {
      key: "idleAzureFirewalls",
      resourceType: "microsoft.network/azurefirewalls",
      zombieType: "APP_GATEWAY_EMPTY",
      monthlyCost: 900.0,
      reason: "Azure Firewall sin reglas activas ni policy vinculada",
    },
    {
      key: "orphanedNsgs",
      resourceType: "microsoft.network/networksecuritygroups",
      zombieType: "VPN_GATEWAY",
      monthlyCost: 0,
      reason: "NSG sin NICs ni Subnets asociadas",
    },
    {
      key: "orphanedAsgs",
      resourceType: "microsoft.network/applicationsecuritygroups",
      zombieType: "VPN_GATEWAY",
      monthlyCost: 0,
      reason: "ASG sin NICs asociadas",
    },
    {
      key: "privateEndpoints",
      resourceType: "microsoft.network/privateendpoints",
      zombieType: "PRIVATE_ENDPOINT_ORPHAN",
      monthlyCost: 7.2,
      reason: "Conexión Private Link en estado Disconnected / Rejected",
    },
    {
      key: "privateDnsZones",
      resourceType: "microsoft.network/privatednszones",
      zombieType: "VPN_GATEWAY",
      monthlyCost: 0.5,
      reason: "Zona Private DNS sin Virtual Network Links",
    },
    {
      key: "ddos",
      resourceType: "microsoft.network/ddosprotectionplans",
      zombieType: "APP_GATEWAY_EMPTY",
      monthlyCost: 2944.0,
      reason: "Plan DDoS Standard sin VNets protegidas",
    },
    {
      key: "natGateways",
      resourceType: "microsoft.network/natgateways",
      zombieType: "NAT_GATEWAY_EMPTY",
      monthlyCost: 32.85,
      reason: "NAT Gateway sin subnets asociadas devengando tarifa fija",
    },
    {
      key: "emptyDnsZones",
      resourceType: "microsoft.network/dnszones",
      zombieType: "VPN_GATEWAY",
      monthlyCost: 0.5,
      reason: "Zona DNS pública sin registros configurados",
    },
    {
      key: "networkWatchersNoFlowLogs",
      resourceType: "microsoft.network/networkwatchers",
      zombieType: "PLATFORM_WATCHER",
      monthlyCost: 0,
      reason: "Network Watcher de plataforma Azure ($0.00 USD)",
    },
  ];

  for (const cfg of FLAT_COST_TYPES) {
    const rows = (graphResults as any)?.[cfg.key] as any[] | undefined;
    for (const r of rows || []) {
      const subId = r.subscriptionId || (r.id?.split("/subscriptions/")[1] || "").split("/")[0] || "";
      zombies.push({
        id: r.id,
        name: r.name || r.id?.split("/").pop() || "resource",
        resourceType: cfg.resourceType,
        zombieType: cfg.zombieType,
        location: resolveRegion(r),
        resourceGroup: r.resourceGroup || (r.id?.split("/resourceGroups/")[1] || "").split("/")[0] || "",
        subscriptionId: subId,
        subscriptionName: resolveSubscriptionName(subId, subNameMap),
        monthlyCostUSD: cfg.monthlyCost,
        detectionReason: cfg.reason,
        idleDays: cfg.daysIdle ?? 30,
        isExempted: cfg.zombieType === "PLATFORM_WATCHER",
        exemptionReason: cfg.zombieType === "PLATFORM_WATCHER" ? "Platform Baseline" : undefined,
      });
    }
  }

  // 4. Private Endpoints Completo
  const allPrivateEndpoints = ((graphResults as any)?.allPrivateEndpoints as any[] | undefined) || [];
  const PE_FIXED_MONTHLY_COST = 7.2;
  const privateEndpoints: PrivateEndpointDetailItem[] = allPrivateEndpoints.map((pe: any) => {
    const subId = pe.subscriptionId || (pe.id?.split("/subscriptions/")[1] || "").split("/")[0] || "";
    const stateStr = String(pe.connectionState || pe.status || "Connected");
    const connectionStatus: "Connected" | "Disconnected" | "Rejected" =
      stateStr === "Rejected" ? "Rejected" : stateStr === "Disconnected" ? "Disconnected" : "Connected";

    return {
      id: pe.id,
      name: pe.name || pe.id?.split("/").pop() || "private-endpoint",
      resourceGroup: pe.resourceGroup || (pe.id?.split("/resourceGroups/")[1] || "").split("/")[0] || "",
      subscriptionId: subId,
      subscriptionName: resolveSubscriptionName(subId, subNameMap),
      connectionStatus,
      targetServiceId: pe.targetServiceId,
      monthlyCostUSD: PE_FIXED_MONTHLY_COST,
    };
  });

  return { zombies, privateEndpoints };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Falta parámetro requerido: tenantId" }, { status: 400 });
    }

    // 1. EVALUAR MOCK ANTES DE RBAC
    if (
      isMockTenant(tenantId) ||
      searchParams.get("mock") === "true" ||
      tenantId.startsWith("demo-") ||
      tenantId.startsWith("mock-")
    ) {
      const mockPayload = getMockNetworkingZombiesPayload(tenantId);
      return NextResponse.json({
        success: true,
        mock: true,
        metrics: mockPayload.metrics,
        items: mockPayload.metrics.zombies.map((z) => ({
          resourceId: z.id,
          resourceName: z.name,
          resourceType: z.zombieType,
          armType: z.resourceType,
          resourceGroup: z.resourceGroup,
          subscriptionId: z.subscriptionId,
          subscriptionName: z.subscriptionName,
          region: z.location,
          monthlyCost: z.monthlyCostUSD,
          reason: z.detectionReason,
          daysIdle: z.idleDays,
          isExempted: z.isExempted,
          exemptionReason: z.exemptionReason,
        })),
        totalMonthlyWaste: mockPayload.metrics.totalWasteMonthlyUSD,
        privateEndpointAccumulation: {
          totalCount: mockPayload.metrics.privateEndpoints.length,
          estimatedMonthlyCost: mockPayload.metrics.privateEndpointsMonthlyCostUSD,
        },
        privateEndpointsDetail: mockPayload.metrics.privateEndpoints.map((pe) => ({
          resourceId: pe.id,
          resourceName: pe.name,
          resourceGroup: pe.resourceGroup,
          subscriptionId: pe.subscriptionId,
          subscriptionName: pe.subscriptionName,
          connectionState: pe.connectionStatus,
          monthlyCost: pe.monthlyCostUSD,
        })),
      });
    }

    // 2. VALIDACIÓN RBAC OBLIGATORIA EN TENANTS REALES
    try {
      await requireTenantAccess(request, tenantId);
    } catch (e) {
      if (e instanceof AuthError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }

    const subscriptionId = searchParams.get("subscriptionId") || undefined;
    const cacheKey = `cleanup:zombies-networking:v3:${tenantId}:${subscriptionId || "all"}`;

    const rawData = await getWithStaleWhileRevalidate(
      cacheKey,
      () => fetchLiveNetworkingZombies(tenantId, subscriptionId),
      1800,
      600
    );

    // Integrar exenciones de MySQL
    const exemptions = await getExemptionsForTenant(tenantId);
    const exemptionsMap = new Map(
      exemptions
        .filter((e) => e.recommendationType === "zombies" || e.recommendationType === "networking")
        .map((e) => [(e.resourceId || "").toLowerCase(), e])
    );

    const mergedZombies = rawData.zombies.map((z) => {
      const ex = exemptionsMap.get(z.id.toLowerCase());
      if (ex) {
        return {
          ...z,
          isExempted: true,
          exemptionReason: ex.reason || z.exemptionReason,
        };
      }
      return z;
    });

    const metrics = computeNetworkingZombiesSummary(mergedZombies, rawData.privateEndpoints);

    return NextResponse.json({
      success: true,
      mock: false,
      metrics,
      items: mergedZombies.map((z) => ({
        resourceId: z.id,
        resourceName: z.name,
        resourceType: z.zombieType,
        armType: z.resourceType,
        resourceGroup: z.resourceGroup,
        subscriptionId: z.subscriptionId,
        subscriptionName: z.subscriptionName,
        region: z.location,
        monthlyCost: z.monthlyCostUSD,
        reason: z.detectionReason,
        daysIdle: z.idleDays,
        isExempted: z.isExempted,
        exemptionReason: z.exemptionReason,
      })),
      totalMonthlyWaste: metrics.totalWasteMonthlyUSD,
      privateEndpointAccumulation: {
        totalCount: metrics.privateEndpoints.length,
        estimatedMonthlyCost: metrics.privateEndpointsMonthlyCostUSD,
      },
      privateEndpointsDetail: metrics.privateEndpoints.map((pe) => ({
        resourceId: pe.id,
        resourceName: pe.name,
        resourceGroup: pe.resourceGroup,
        subscriptionId: pe.subscriptionId,
        subscriptionName: pe.subscriptionName,
        connectionState: pe.connectionStatus,
        monthlyCost: pe.monthlyCostUSD,
      })),
    });
  } catch (err: unknown) {
    console.error("[zombies/networking] error:", errorMessage(err));
    return NextResponse.json({ error: errorMessage(err) || "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    if (!isMockTenant(tenantId)) {
      try {
        await requireTenantRole(request, tenantId, ["Admin", "Owner", "Contributor", "FinOps"]);
      } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        throw e;
      }
    }

    const body = await request.json();
    const { action, resourceId, resourceName, reason, comment } = body;

    if (action === "exempt") {
      if (!resourceId) {
        return NextResponse.json({ error: "Falta resourceId" }, { status: 400 });
      }
      await upsertExemption(tenantId, {
        resourceId,
        resourceName: resourceName || resourceId.split("/").pop() || "resource",
        recommendationType: "networking",
        reason: reason || "Eximido por el usuario en Networking Zombies",
        comment: comment || null,
        createdBy: "user",
      });
      await invalidateCache(`cleanup:zombies-networking:v3:${tenantId}:all`);
      return NextResponse.json({ success: true, message: "Recurso eximido exitosamente" });
    }

    if (action === "remove_exemption") {
      if (!resourceId) {
        return NextResponse.json({ error: "Falta resourceId" }, { status: 400 });
      }
      await deleteExemption(tenantId, resourceId);
      await invalidateCache(`cleanup:zombies-networking:v3:${tenantId}:all`);
      return NextResponse.json({ success: true, message: "Exención removida exitosamente" });
    }

    return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
  } catch (err: unknown) {
    console.error("[zombies/networking POST] error:", errorMessage(err));
    return NextResponse.json({ error: errorMessage(err) || "Internal server error" }, { status: 500 });
  }
}
