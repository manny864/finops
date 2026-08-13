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
import { getAzureCredential } from "@/lib/azure";
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

const MOCK_SUMMARY: DdosSummary = {
  totalMonthlyCost: 2995,
  activePlans: 2,
  protectedVnets: 18,
  protectedPublicIps: 46,
  protectedApplications: 23,
  coveragePercentage: 96,
  unprotectedResources: 7,
  costPerProtectedResource: 65.1,
  totalAttacksDetected: 127,
  attacksMitigated: 126,
  lastAttackTime: new Date(Date.now() - 34 * 24 * 60 * 60 * 1000).toISOString(),
  dayssinceLastAttack: 34,
  riskLevel: "Low",
  plans: [
    {
      planId: "/subscriptions/sub-123/resourceGroups/prod-networking-rg/providers/Microsoft.Network/ddosProtectionPlans/prod-ddos-plan",
      planName: "prod-ddos-plan",
      region: "East US",
      resourceGroup: "prod-networking-rg",
      costPerMonth: 2995,
      protectedVnets: 12,
      protectedPublicIps: 28,
      protectedApplications: 15,
      status: "Active",
      createdDate: "2024-06-15T10:30:00Z",
    },
    {
      planId: "/subscriptions/sub-456/resourceGroups/dr-networking-rg/providers/Microsoft.Network/ddosProtectionPlans/dr-ddos-plan",
      planName: "dr-ddos-plan",
      region: "UK South",
      resourceGroup: "dr-networking-rg",
      costPerMonth: 0, // Inherited from parent subscription
      protectedVnets: 6,
      protectedPublicIps: 18,
      protectedApplications: 8,
      status: "Active",
      createdDate: "2024-08-01T15:45:00Z",
    },
  ],
  recentAttacks: [
    {
      id: "attack-127",
      type: "UDP Flood",
      startTime: new Date(Date.now() - 34 * 24 * 60 * 60 * 1000).toISOString(),
      duration: 4,
      peakTrafficGbps: 45.2,
      packetsPerSecond: 1200000,
      sourceCountries: ["CN", "RU"],
      targetResourceId: "/subscriptions/sub-123/resourceGroups/prod-networking-rg/providers/Microsoft.Network/publicIPAddresses/api-public-ip",
      mitigationStatus: "Mitigated",
      bytesDropped: 1890000000,
    },
    {
      id: "attack-126",
      type: "TCP SYN Flood",
      startTime: new Date(Date.now() - 36 * 24 * 60 * 60 * 1000).toISOString(),
      duration: 8,
      peakTrafficGbps: 32.8,
      packetsPerSecond: 890000,
      sourceCountries: ["IR", "KP"],
      targetResourceId: "/subscriptions/sub-456/resourceGroups/dr-networking-rg/providers/Microsoft.Network/publicIPAddresses/webapp-public-ip",
      mitigationStatus: "Mitigated",
      bytesDropped: 1234000000,
    },
    {
      id: "attack-125",
      type: "Reflection Amplification",
      startTime: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
      duration: 12,
      peakTrafficGbps: 78.5,
      packetsPerSecond: 2100000,
      sourceCountries: ["BR", "VN", "IN"],
      targetResourceId: "/subscriptions/sub-123/resourceGroups/prod-networking-rg/providers/Microsoft.Network/publicIPAddresses/frontend-public-ip",
      mitigationStatus: "Mitigated",
      bytesDropped: 3450000000,
    },
  ],
  recommendations: [
    "7 recursos de red detectados sin protección DDoS. Evalúa asociarlos a un plan DDoS.",
    "Último ataque hace 34 días. Mantener vigilancia con Azure Monitor alertas configuradas.",
    "Cobertura de 96% es excelente. Incrementar a 100% para una postura defensiva robusta.",
    "Costos: 2 planes activos por $2,995/mes. Evaluar consolidación si los VNets están en la misma región.",
    "Los ataques detectados fueron mitigados automáticamente. No hay incidentes no mitigados.",
  ],
};

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

    // Mock data para demo tenants
    if (isMockTenant(tenantId)) {
      return NextResponse.json({
        success: true,
        mock: true,
        ...MOCK_SUMMARY,
      });
    }

    // Caso real: consultar Azure APIs
    const subscriptionIds = searchParams.get("subscriptionIds")?.split(",") || [];
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
