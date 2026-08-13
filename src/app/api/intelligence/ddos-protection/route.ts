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

    // Mock data para demo
    if (isMockTenant(tenantId)) {
      return NextResponse.json({
        success: true,
        mock: true,
        ...MOCK_SUMMARY,
      });
    }

    // Caso real: consultar Azure APIs
    // Por ahora, retorna estructura lista para implementar
    const summary: DdosSummary = {
      totalMonthlyCost: 0,
      activePlans: 0,
      protectedVnets: 0,
      protectedPublicIps: 0,
      protectedApplications: 0,
      coveragePercentage: 0,
      unprotectedResources: 0,
      costPerProtectedResource: 0,
      totalAttacksDetected: 0,
      attacksMitigated: 0,
      lastAttackTime: null,
      dayssinceLastAttack: 0,
      riskLevel: "Medium",
      plans: [],
      recentAttacks: [],
      recommendations: [],
    };

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
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
