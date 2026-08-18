/**
 * GET /api/intelligence/ddos-protection — DDoS Protection cost and coverage metrics
 * from Azure DDoS Protection Standard plans.
 *
 * RBAC: Tier Business+.
 * Azure roles: Network Contributor, Security Reader.
 * Azure resources:
 *   - microsoft.network/ddosprotectionplans
 *   - microsoft.network/virtualnetworks (linked VNets)
 *   - microsoft.network/publicipaddresses (public IPs)
 * Metrics: IfUnderDDoSAttack, DDoSTriggerSYNPackets, BytesDropped, etc.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import { CostManagementClient } from "@azure/arm-costmanagement";

interface DdosPlan {
  planId: string;
  planName: string;
  region: string;
  resourceGroup: string;
  costPerMonth: number;
  protectedVnets: number;
  protectedPublicIps: number;
  protectedApplications: number;
  status: "Active" | "Inactive";
  createdDate: string;
}

interface DdosAttack {
  id: string;
  type: "Volumetric" | "TCP SYN Flood" | "UDP Flood" | "Reflection Amplification" | "Other";
  startTime: string;
  duration: number; // minutes
  peakTrafficGbps: number;
  packetsPerSecond: number;
  sourceCountries: string[];
  targetResourceId: string;
  mitigationStatus: "Mitigated" | "In Progress" | "Failed";
  bytesDropped: number;
}

interface DdosSummary {
  totalMonthlyCost: number;
  activePlans: number;
  protectedVnets: number;
  protectedPublicIps: number;
  protectedApplications: number;
  coveragePercentage: number;
  unprotectedResources: number;
  costPerProtectedResource: number;
  totalAttacksDetected: number;
  attacksMitigated: number;
  lastAttackTime: string | null;
  dayssinceLastAttack: number;
  riskLevel: "Low" | "Medium" | "High" | "Critical";
  plans: DdosPlan[];
  recentAttacks: DdosAttack[];
  recommendations: string[];
}

function getMockDdosSummary(tenantId: string): DdosSummary {
    // Scale mock data by tier: Professional = 1x, Business = 2.5x, Enterprise = 6x
    let multiplier = 1.0;
    if (tenantId.includes("business") || tenantId.includes("tier-2")) multiplier = 2.5;
    if (tenantId.includes("enterprise") || tenantId.includes("tier-3")) multiplier = 6.0;

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    const plans: DdosPlan[] = [
        {
            planId: `/subscriptions/sub-prod-001/resourceGroups/rg-hub-security-prod/providers/Microsoft.Network/ddosProtectionPlans/ddos-prod-eastus`,
            planName: "ddos-prod-eastus",
            region: "East US",
            resourceGroup: "rg-hub-security-prod",
            costPerMonth: Number((2944.00 * multiplier).toFixed(2)),
            protectedVnets: Math.round(12 * multiplier),
            protectedPublicIps: Math.round(28 * multiplier),
            protectedApplications: Math.round(15 * multiplier),
            status: "Active",
            createdDate: "2024-06-15T10:30:00Z",
        },
        {
            planId: `/subscriptions/sub-prod-002/resourceGroups/rg-hub-security-westeu/providers/Microsoft.Network/ddosProtectionPlans/ddos-prod-westeurope`,
            planName: "ddos-prod-westeurope",
            region: "West Europe",
            resourceGroup: "rg-hub-security-westeu",
            costPerMonth: Number((2944.00 * multiplier).toFixed(2)),
            protectedVnets: Math.round(8 * multiplier),
            protectedPublicIps: Math.round(22 * multiplier),
            protectedApplications: Math.round(10 * multiplier),
            status: "Active",
            createdDate: "2024-09-01T08:00:00Z",
        },
        {
            planId: `/subscriptions/sub-dr-001/resourceGroups/rg-dr-networking/providers/Microsoft.Network/ddosProtectionPlans/ddos-dr-uksouth`,
            planName: "ddos-dr-uksouth",
            region: "UK South",
            resourceGroup: "rg-dr-networking",
            costPerMonth: multiplier >= 2.5 ? Number((2944.00 * multiplier).toFixed(2)) : 0,
            protectedVnets: Math.round(6 * multiplier),
            protectedPublicIps: Math.round(18 * multiplier),
            protectedApplications: Math.round(8 * multiplier),
            status: "Active",
            createdDate: "2024-11-20T14:15:00Z",
        },
    ];

    // Enterprise gets an extra plan in Southeast Asia
    if (multiplier >= 6.0) {
        plans.push({
            planId: `/subscriptions/sub-apac-001/resourceGroups/rg-hub-security-seasia/providers/Microsoft.Network/ddosProtectionPlans/ddos-prod-seasia`,
            planName: "ddos-prod-seasia",
            region: "Southeast Asia",
            resourceGroup: "rg-hub-security-seasia",
            costPerMonth: Number((2944.00 * multiplier).toFixed(2)),
            protectedVnets: 10,
            protectedPublicIps: 35,
            protectedApplications: 18,
            status: "Active",
            createdDate: "2025-03-10T06:30:00Z",
        });
    }

    const totalProtectedVnets = plans.reduce((s, p) => s + p.protectedVnets, 0);
    const totalProtectedIps = plans.reduce((s, p) => s + p.protectedPublicIps, 0);
    const totalProtectedApps = plans.reduce((s, p) => s + p.protectedApplications, 0);
    const totalCost = plans.reduce((s, p) => s + p.costPerMonth, 0);
    const unprotectedResources = Math.max(0, Math.round(7 * multiplier - totalProtectedVnets * 0.05));

    const attacks: DdosAttack[] = [
        {
            id: "attack-001",
            type: "UDP Flood",
            startTime: new Date(now - 2 * day).toISOString(),
            duration: 4,
            peakTrafficGbps: Number((45.2 * multiplier).toFixed(1)),
            packetsPerSecond: Math.round(1_200_000 * multiplier),
            sourceCountries: ["CN", "RU", "VN"],
            targetResourceId: "/subscriptions/sub-prod-001/resourceGroups/rg-hub-security-prod/providers/Microsoft.Network/publicIPAddresses/api-gateway-public-ip",
            mitigationStatus: "Mitigated",
            bytesDropped: Math.round(1_890_000_000 * multiplier),
        },
        {
            id: "attack-002",
            type: "TCP SYN Flood",
            startTime: new Date(now - 5 * day).toISOString(),
            duration: 8,
            peakTrafficGbps: Number((32.8 * multiplier).toFixed(1)),
            packetsPerSecond: Math.round(890_000 * multiplier),
            sourceCountries: ["IR", "KP"],
            targetResourceId: "/subscriptions/sub-prod-002/resourceGroups/rg-hub-security-westeu/providers/Microsoft.Network/publicIPAddresses/webapp-frontend-ip",
            mitigationStatus: "Mitigated",
            bytesDropped: Math.round(1_234_000_000 * multiplier),
        },
        {
            id: "attack-003",
            type: "Reflection Amplification",
            startTime: new Date(now - 12 * day).toISOString(),
            duration: 12,
            peakTrafficGbps: Number((78.5 * multiplier).toFixed(1)),
            packetsPerSecond: Math.round(2_100_000 * multiplier),
            sourceCountries: ["BR", "VN", "IN", "NG"],
            targetResourceId: "/subscriptions/sub-prod-001/resourceGroups/rg-hub-security-prod/providers/Microsoft.Network/publicIPAddresses/cdn-frontdoor-ip",
            mitigationStatus: "Mitigated",
            bytesDropped: Math.round(3_450_000_000 * multiplier),
        },
        {
            id: "attack-004",
            type: "Volumetric",
            startTime: new Date(now - 18 * day).toISOString(),
            duration: 22,
            peakTrafficGbps: Number((120.3 * multiplier).toFixed(1)),
            packetsPerSecond: Math.round(3_500_000 * multiplier),
            sourceCountries: ["CN", "RU", "IR", "KP", "BR"],
            targetResourceId: "/subscriptions/sub-prod-001/resourceGroups/rg-hub-security-prod/providers/Microsoft.Network/publicIPAddresses/vpn-gateway-public-ip",
            mitigationStatus: "Mitigated",
            bytesDropped: Math.round(8_900_000_000 * multiplier),
        },
        {
            id: "attack-005",
            type: "UDP Flood",
            startTime: new Date(now - 25 * day).toISOString(),
            duration: 3,
            peakTrafficGbps: Number((18.7 * multiplier).toFixed(1)),
            packetsPerSecond: Math.round(650_000 * multiplier),
            sourceCountries: ["RU", "UA"],
            targetResourceId: "/subscriptions/sub-dr-001/resourceGroups/rg-dr-networking/providers/Microsoft.Network/publicIPAddresses/dr-app-public-ip",
            mitigationStatus: "Mitigated",
            bytesDropped: Math.round(560_000_000 * multiplier),
        },
    ];

    // Enterprise gets more attack variety
    if (multiplier >= 6.0) {
        attacks.push(
            {
                id: "attack-006",
                type: "TCP SYN Flood",
                startTime: new Date(now - 8 * day).toISOString(),
                duration: 15,
                peakTrafficGbps: 95.4,
                packetsPerSecond: 4_200_000,
                sourceCountries: ["CN", "HK", "SG"],
                targetResourceId: "/subscriptions/sub-apac-001/resourceGroups/rg-hub-security-seasia/providers/Microsoft.Network/publicIPAddresses/erp-public-ip",
                mitigationStatus: "Mitigated",
                bytesDropped: 5_670_000_000,
            },
            {
                id: "attack-007",
                type: "Reflection Amplification",
                startTime: new Date(now - 15 * day).toISOString(),
                duration: 6,
                peakTrafficGbps: 142.8,
                packetsPerSecond: 5_800_000,
                sourceCountries: ["US", "DE", "JP", "KR", "BR"],
                targetResourceId: "/subscriptions/sub-apac-001/resourceGroups/rg-hub-security-seasia/providers/Microsoft.Network/publicIPAddresses/gaming-public-ip",
                mitigationStatus: "Mitigated",
                bytesDropped: 12_340_000_000,
            },
        );
    }

    const totalAttacksDetected = attacks.length;
    const attacksMitigated = attacks.filter((a) => a.mitigationStatus === "Mitigated").length;
    const lastAttack = attacks[0];
    const daysSinceLastAttack = Math.round((now - new Date(lastAttack.startTime).getTime()) / day);

    // Risk level: more resources = more surface area, but also more protection
    const coveragePct = unprotectedResources === 0 ? 100 : Math.max(80, Math.round(100 - (unprotectedResources / (totalProtectedVnets + unprotectedResources)) * 100));
    let riskLevel: DdosSummary["riskLevel"] = "Low";
    if (unprotectedResources > 10) riskLevel = "Medium";
    if (unprotectedResources > 25) riskLevel = "High";
    if (daysSinceLastAttack < 3 && attacksMitigated < totalAttacksDetected) riskLevel = "Critical";

    const costPerProtected = totalProtectedVnets > 0
        ? Number((totalCost / totalProtectedVnets).toFixed(2))
        : 0;

    const recommendations: string[] = [];
    if (unprotectedResources > 0) {
        recommendations.push(`${unprotectedResources} recursos de red detectados sin protección DDoS. Evalúa asociarlos a un plan DDoS.`);
    }
    if (daysSinceLastAttack < 7) {
        recommendations.push(`Último ataque hace ${daysSinceLastAttack} días. Mantener vigilancia con Azure Monitor alertas configuradas.`);
    } else {
        recommendations.push(`Último ataque hace ${daysSinceLastAttack} días. La postura defensiva es sólida.`);
    }
    if (coveragePct < 100) {
        recommendations.push(`Cobertura de ${coveragePct}%. Incrementar a 100% para una postura defensiva robusta.`);
    } else {
        recommendations.push("Cobertura del 100%. Todos los recursos de red están protegidos contra DDoS.");
    }
    if (plans.length > 2) {
        recommendations.push(`${plans.length} planes activos por $${totalCost.toFixed(0)}/mes. Evaluar consolidación regional para reducir costos fijos.`);
    }
    if (totalCost > 5000) {
        recommendations.push(`Costo mensual elevado ($${totalCost.toFixed(0)}/mes). Considerar migrar planes Network Protection a IP Protection en VNets con <10 IPs públicas.`);
    }
    recommendations.push("Todos los ataques detectados fueron mitigados automáticamente por Azure DDoS Protection Standard.");

    return {
        totalMonthlyCost: Number(totalCost.toFixed(2)),
        activePlans: plans.length,
        protectedVnets: totalProtectedVnets,
        protectedPublicIps: totalProtectedIps,
        protectedApplications: totalProtectedApps,
        coveragePercentage: coveragePct,
        unprotectedResources,
        costPerProtectedResource: costPerProtected,
        totalAttacksDetected,
        attacksMitigated,
        lastAttackTime: lastAttack.startTime,
        dayssinceLastAttack: daysSinceLastAttack,
        riskLevel,
        plans,
        recentAttacks: attacks,
        recommendations,
    };
}

async function getDdosSummaryFromAzure(tenantId: string, subscriptionIds: string[]): Promise<DdosSummary> {
  try {
    const credential = await getAzureCredential(tenantId);
    const ARM_BASE = "https://management.azure.com";
    const API_VERSION = "2022-12-01";

    // Token para ARM API
    const tokenData = await credential.getToken(`${ARM_BASE}/.default`);
    if (!tokenData) throw new Error("No se pudo obtener el token de Azure Management");
    const token = tokenData.token;

    const plans: DdosPlan[] = [];
    let totalCost = 0;
    let totalProtectedVnets = 0;
    let totalProtectedPublicIps = 0;
    let totalProtectedApplications = 0;

    // Consultar DDoS Protection Plans
    for (const subId of subscriptionIds) {
      try {
        const url = `${ARM_BASE}/subscriptions/${subId}/providers/Microsoft.Network/ddosProtectionPlans?api-version=${API_VERSION}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const json: any = await res.json();
          for (const plan of json.value || []) {
            const planId = String(plan.id || "");
            const planName = String(plan.name || "");
            const region = String(plan.location || "unknown");
            const rgMatch = planId.match(/\/resourceGroups\/([^/]+)\//);
            const resourceGroup = rgMatch ? rgMatch[1] : "unknown";

            // Contar VNets y Public IPs vinculadas
            const linkedVnets = Array.isArray(plan.properties?.virtualNetworks) 
              ? plan.properties.virtualNetworks.length 
              : 0;
            
            plans.push({
              planId,
              planName,
              region,
              resourceGroup,
              costPerMonth: 0, // Se actualiza con Cost Management
              protectedVnets: linkedVnets,
              protectedPublicIps: 0, // Requeriría consulta adicional
              protectedApplications: linkedVnets, // Aproximación
              status: "Active",
              createdDate: String(plan.properties?.creationTime || new Date().toISOString()),
            });

            totalProtectedVnets += linkedVnets;
            totalProtectedApplications += linkedVnets;
          }
        }
      } catch (e) {
        console.warn(`[DDoS] Error querying plans in ${subId}:`, e instanceof Error ? e.message : e);
      }
    }

    // Si no hay planes, lanzar error
    if (plans.length === 0) {
      throw new Error("No se encontraron planes de DDoS Protection activos");
    }

    // Obtener costos reales
    try {
      const costClient = new CostManagementClient(credential);
      if (subscriptionIds.length > 0) {
        const costRes = await costClient.query.usage(`/subscriptions/${subscriptionIds[0]}`, {
          type: "ActualCost",
          timeframe: "MonthToDate",
          dataset: {
            granularity: "None",
            aggregation: { totalCost: { name: "Cost", function: "Sum" } },
            filter: {
              dimensions: {
                name: "ServiceName",
                operator: "In",
                values: [
                  "DDoS Protection",
                  "Azure DDoS Protection Standard",
                ],
              },
            },
          },
        });

        const cols = (costRes.columns || []).map((c: any) => String(c.name).toLowerCase());
        const costIdx = cols.indexOf("cost");
        for (const row of costRes.rows || []) {
          totalCost += costIdx >= 0 ? Number(row[costIdx]) || 0 : 0;
        }

        // Distribuir costo entre planes
        if (plans.length > 0) {
          const costPerPlan = totalCost / plans.length;
          for (const plan of plans) {
            plan.costPerMonth = Number(costPerPlan.toFixed(2));
          }
        }
      }
    } catch (e) {
      console.warn(`[DDoS] Cost Management error:`, e instanceof Error ? e.message : e);
    }

    const costPerProtected = totalProtectedVnets > 0 
      ? Number((totalCost / totalProtectedVnets).toFixed(2))
      : 0;

    const summary: DdosSummary = {
      totalMonthlyCost: Number(totalCost.toFixed(2)),
      activePlans: plans.length,
      protectedVnets: totalProtectedVnets,
      protectedPublicIps: totalProtectedPublicIps,
      protectedApplications: totalProtectedApplications,
      coveragePercentage: 0, // Requeriría consultar todos los VNets
      unprotectedResources: 0,
      costPerProtectedResource: costPerProtected,
      totalAttacksDetected: 0,
      attacksMitigated: 0,
      lastAttackTime: null,
      dayssinceLastAttack: 0,
      riskLevel: "Medium",
      plans,
      recentAttacks: [],
      recommendations: [
        `${plans.length} plan(s) DDoS activo(s) protegiendo ${totalProtectedVnets} VNets`,
        `Costo mensual: $${totalCost.toFixed(2)}`,
        totalProtectedVnets > 0 ? `Costo por VNet protegida: $${costPerProtected}` : "",
      ].filter(Boolean),
    };

    return summary;
  } catch (e) {
    console.error(`[DDoS] Fatal error querying Azure for ${tenantId}:`, e instanceof Error ? e.message : e);
    throw e;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    if (!isMockTenant(tenantId)) {
      await requireTenantTier(request, tenantId, "Business");
    } else {
      await requireTenantAccess(request, tenantId);
    }

    // Mock data para demo tenants — escala por tier (Professional 1x, Business 2.5x, Enterprise 6x)
    if (isMockTenant(tenantId)) {
      const mockData = getMockDdosSummary(tenantId);
      return NextResponse.json({
        success: true,
        mock: true,
        ...mockData,
      });
    }

    // Caso real: consultar Azure APIs
    const requestedSubscriptionIds =
      searchParams
        .get("subscriptionIds")
        ?.split(",")
        .map((id) => id.trim())
        .filter(Boolean) || [];
    const subscriptionIds =
      requestedSubscriptionIds.length > 0
        ? requestedSubscriptionIds
        : await getSubscriptionsForTenant(tenantId);
    const summary = await getDdosSummaryFromAzure(tenantId, subscriptionIds);

    return NextResponse.json({
      success: true,
      mock: false,
      ...summary,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("DDoS Protection API Error:", error);
    const errorMessage = error instanceof Error ? error.message : "No se pudieron obtener los datos de DDoS Protection";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
