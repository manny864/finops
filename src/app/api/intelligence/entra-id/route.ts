/**
 * GET /api/intelligence/entra-id — tipos de licencia de Entra ID,
 * conteo de usuarios por tipo, costos mensuales estimados.
 *
 * RBAC: Tier Business+.
 * Azure roles: Directory Readers, License Administrator.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";

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

    // Caso real: consultar Graph API para obtener licencias asignadas
    // Por ahora, retorna estructura lista para implementar
    const summary: EntraIdSummary = {
      totalActiveUsers: 0,
      totalAssignedLicenses: 0,
      totalSubscriptionsAmount: 0,
      licenseCoverage: 0,
      licenseBreakdown: [],
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
    console.error("Entra ID API Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
