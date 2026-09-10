/**
 * GET /api/intelligence/entra-id — tipos de licencia de Entra ID,
 * conteo de usuarios por tipo, costos mensuales estimados.
 *
 * RBAC: Tier Business+.
 * Azure roles: Directory Readers, License Administrator (Microsoft Graph API).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getAzureCredential } from "@/lib/azure";

interface EntraIdLicense {
  licenseType: "Free" | "Premium P1" | "Premium P2" | "Standalone";
  assignedLicenses: number;
  remainingLicenses: number;
  totalLicenses: number;
  costPerLicensePerMonth: number;
  estimatedMonthlyCost: number;
  usagePercentage: number;
  recommendations: string[];
  lastSyncedAt: string;
}

interface EntraIdSummary {
  totalActiveUsers: number;
  totalAssignedLicenses: number;
  totalSubscriptionsAmount: number;
  licenseCoverage: number; // %
  licenseBreakdown: EntraIdLicense[];
}

const MOCK_LICENSES: EntraIdLicense[] = [
  {
    licenseType: "Free",
    assignedLicenses: 150,
    remainingLicenses: 50,
    totalLicenses: 200,
    costPerLicensePerMonth: 0,
    estimatedMonthlyCost: 0,
    usagePercentage: 75,
    recommendations: [
      "150 usuarios en tier Free (sin costo). Suficiente para usuarios básicos sin requisitos de MFA avanzada.",
      "50 licencias Free disponibles. Considera migrar usuarios de P1 si sus requisitos son básicos.",
    ],
    lastSyncedAt: new Date().toISOString(),
  },
  {
    licenseType: "Premium P1",
    assignedLicenses: 280,
    remainingLicenses: 20,
    totalLicenses: 300,
    costPerLicensePerMonth: 6,
    estimatedMonthlyCost: 1680,
    usagePercentage: 93.33,
    recommendations: [
      "280 usuarios en P1 ($6/usuario/mes). Alta utilización (93.33%). Asegura que las capacidades se están usando (MFA, Conditional Access básico, Self-Service Password Reset).",
      "Próximo aumento de P1 o migración a P2 según requisitos avanzados de seguridad.",
    ],
    lastSyncedAt: new Date().toISOString(),
  },
  {
    licenseType: "Premium P2",
    assignedLicenses: 85,
    remainingLicenses: 15,
    totalLicenses: 100,
    costPerLicensePerMonth: 9,
    estimatedMonthlyCost: 765,
    usagePercentage: 85,
    recommendations: [
      "85 usuarios en P2 ($9/usuario/mes). Cobertura de 85% de licencias. P2 incluye Identity Protection, Privileged Identity Management (PIM), y access reviews.",
      "Valida que los 85 usuarios realmente usan features P2. Si no, considera migrar a P1 para optimizar costos.",
    ],
    lastSyncedAt: new Date().toISOString(),
  },
];

// Precios conocidos de Entra ID (puede cambiar, verificar con Azure Pricing)
const LICENSE_COSTS: Record<string, number> = {
  "Premium P1": 6,
  "Premium P2": 9,
  "Free": 0,
  "Standalone": 0,
};

async function getEntraIdLicensesFromGraph(tenantId: string): Promise<EntraIdSummary> {
  const graphBaseUrl = "https://graph.microsoft.com/v1.0";
  
  try {
    const credential = await getAzureCredential(tenantId);
    const tokenData = await credential.getToken("https://graph.microsoft.com/.default");
    if (!tokenData) {
      throw new Error("No se pudo obtener token de Microsoft Graph");
    }
    const accessToken = tokenData.token;

    // Consultar suscripciones activas (subscriptions)
    const subsRes = await fetch(`${graphBaseUrl}/directory/subscriptions`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    
    if (!subsRes.ok) {
      console.warn(`[EntraID] subscriptions query failed: ${subsRes.status}`);
      throw new Error("No se pudieron obtener las suscripciones de Entra ID");
    }

    const subsJson: any = await subsRes.json();
    const subscriptions = Array.isArray(subsJson.value) ? subsJson.value : [];

    // Mapear suscripciones a licencias de Entra ID
    const licenseMap: Map<string, EntraIdLicense> = new Map();

    for (const sub of subscriptions) {
      const skuPartNumber = String(sub.skuPartNumber || "").toUpperCase();
      let licenseType: EntraIdLicense["licenseType"] = "Standalone";
      
      if (skuPartNumber.includes("AAD_PREMIUM_P2") || skuPartNumber.includes("ENTERPRISEMOBILITY")) {
        licenseType = "Premium P2";
      } else if (skuPartNumber.includes("AAD_PREMIUM") || skuPartNumber.includes("IDENTITYGOVERNANCE")) {
        licenseType = "Premium P1";
      }

      const prepaidCount = Number(sub.prepaidUnits?.enabled || 0);
      const totalLicenses = prepaidCount;
      const consumedUnits = Number(sub.consumedUnits || 0);
      const remainingLicenses = totalLicenses - consumedUnits;

      const costPerMonth = LICENSE_COSTS[licenseType] || 0;
      const estimatedMonthlyCost = consumedUnits * costPerMonth;

      licenseMap.set(licenseType, {
        licenseType,
        assignedLicenses: consumedUnits,
        remainingLicenses: Math.max(0, remainingLicenses),
        totalLicenses,
        costPerLicensePerMonth: costPerMonth,
        estimatedMonthlyCost: Number(estimatedMonthlyCost.toFixed(2)),
        usagePercentage: totalLicenses > 0 ? Math.round((consumedUnits / totalLicenses) * 100) : 0,
        recommendations: getRecommendations(licenseType, consumedUnits, totalLicenses),
        lastSyncedAt: new Date().toISOString(),
      });
    }

    // Si no hay suscripciones, lanzar error
    if (licenseMap.size === 0) {
      throw new Error("No se encontraron suscripciones de Entra ID activas");
    }

    const licenseBreakdown = Array.from(licenseMap.values());
    const totalAssignedLicenses = licenseBreakdown.reduce((sum, lic) => sum + lic.assignedLicenses, 0);
    const totalLicenses = licenseBreakdown.reduce((sum, lic) => sum + lic.totalLicenses, 0);

    const summary: EntraIdSummary = {
      totalActiveUsers: totalAssignedLicenses,
      totalAssignedLicenses,
      totalSubscriptionsAmount: licenseBreakdown.reduce((sum, lic) => sum + lic.estimatedMonthlyCost, 0),
      licenseCoverage: totalLicenses > 0 ? Math.round((totalAssignedLicenses / totalLicenses) * 100) : 0,
      licenseBreakdown,
    };

    return summary;
  } catch (e) {
    console.error(`[EntraID] Error querying Graph API for ${tenantId}:`, e instanceof Error ? e.message : e);
    throw e;
  }
}

function getRecommendations(licenseType: EntraIdLicense["licenseType"], assigned: number, total: number): string[] {
  const recs: string[] = [];
  const usage = total > 0 ? (assigned / total) * 100 : 0;

  if (usage < 50) {
    recs.push(`Baja utilización (${Math.round(usage)}%). Considera reducir el número de licencias ${licenseType}.`);
  } else if (usage > 90) {
    recs.push(`Alta utilización (${Math.round(usage)}%). Prepárate para aumentar el número de licencias ${licenseType}.`);
  }

  switch (licenseType) {
    case "Premium P1":
      recs.push("P1 incluye MFA, Conditional Access básico, Self-Service Password Reset. Verifica que se esté usando.");
      break;
    case "Premium P2":
      recs.push("P2 incluye Identity Protection, Privileged Identity Management (PIM), Access Reviews. Valida su uso para justificar el costo adicional.");
      break;
    case "Free":
      recs.push("Usuarios en tier Free (sin costo). Considera migrar a P1 si requieren autenticación multifactor.");
      break;
  }

  return recs;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    if (!isMockTenant(tenantId)) {
      await requireTenantTier(request, tenantId, "Enterprise");
    } else {
      await requireTenantAccess(request, tenantId);
    }

    // Mock data para demo tenants
    if (isMockTenant(tenantId)) {
      const totalActiveUsers = MOCK_LICENSES.reduce((sum, lic) => sum + lic.assignedLicenses, 0);
      const totalAssignedLicenses = MOCK_LICENSES.reduce((sum, lic) => sum + lic.assignedLicenses, 0);
      const totalSubscriptionsAmount = MOCK_LICENSES.reduce(
        (sum, lic) => sum + lic.estimatedMonthlyCost,
        0
      );

      const summary: EntraIdSummary = {
        totalActiveUsers,
        totalAssignedLicenses,
        totalSubscriptionsAmount,
        licenseCoverage: Math.round(
          (totalAssignedLicenses /
            MOCK_LICENSES.reduce((sum, lic) => sum + lic.totalLicenses, 0)) *
            100
        ),
        licenseBreakdown: MOCK_LICENSES,
      };

      return NextResponse.json({
        success: true,
        mock: true,
        ...summary,
      });
    }

    // Caso real: consultar Microsoft Graph API con credencial del tenant.
    const summary = await getEntraIdLicensesFromGraph(tenantId);

    return NextResponse.json({
      success: true,
      mock: false,
      ...summary,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Entra ID API Error:", error);
    const errorMessage = error instanceof Error ? error.message : "No se pudieron obtener las licencias de Entra ID";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
