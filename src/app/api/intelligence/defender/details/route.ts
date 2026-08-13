/**
 * GET /api/intelligence/defender/details — detalles granulares de Defender for Cloud
 * con diferenciación de planes (Servers Plan 1/2, Storage, Containers, SQL, CSPM).
 * Costos por defender type, recursos protegidos, y recomendaciones de optimización.
 *
 * RBAC: Business+ tier.
 * Azure roles: Security Reader, Cost Management Reader.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getAzureCredential } from "@/lib/azure";
import { getSubscriptionsForTenant } from "@/lib/azure";
import { CostManagementClient } from "@azure/arm-costmanagement";

interface DefenderPlanDetail {
  planId: string;
  planName: string;
  name: string; // e.g. "Defender for Servers", "Defender for SQL Servers"
  planType: "Servers Plan 1" | "Servers Plan 2" | "Storage" | "Containers" | "SQL" | "CSPM" | "Other";
  pricingTier: "Free" | "Standard";
  subscriptionId: string;
  subscriptionName: string;
  estimatedMonthlyCost: number;
  resourcesCovered: number;
  protectionStatus: "Full" | "Partial" | "None";
  lastUpdated: string;
  recommendations: string[];
}

const MOCK_DETAILS: DefenderPlanDetail[] = [
  {
    planId: "defender-servers-p1",
    planName: "VirtualMachines",
    name: "Defender for Servers",
    planType: "Servers Plan 1",
    pricingTier: "Standard",
    subscriptionId: "sub-123",
    subscriptionName: "Production",
    estimatedMonthlyCost: 425.50,
    resourcesCovered: 47,
    protectionStatus: "Full",
    lastUpdated: new Date().toISOString(),
    recommendations: [
      "Plan 1 es adecuado para VM tradicionales. Si tienes cargas de trabajo con requisitos de comportamiento avanzado, considera Plan 2.",
      "47 VMs protegidas. Revisar si todas son críticas para el negocio.",
    ],
  },
  {
    planId: "defender-servers-p2",
    planName: "VirtualMachines",
    name: "Defender for Servers",
    planType: "Servers Plan 2",
    pricingTier: "Standard",
    subscriptionId: "sub-456",
    subscriptionName: "Development",
    estimatedMonthlyCost: 185.75,
    resourcesCovered: 18,
    protectionStatus: "Full",
    lastUpdated: new Date().toISOString(),
    recommendations: [
      "Plan 2 ofrece análisis de comportamiento avanzado. Valida si la cobertura de 18 VMs justifica el costo.",
      "Considera reducir a Plan 1 si no usas capacidades avanzadas.",
    ],
  },
  {
    planId: "defender-storage",
    planName: "StorageAccounts",
    name: "Defender for Storage",
    planType: "Storage",
    pricingTier: "Standard",
    subscriptionId: "sub-123",
    subscriptionName: "Production",
    estimatedMonthlyCost: 92.30,
    resourcesCovered: 12,
    protectionStatus: "Full",
    lastUpdated: new Date().toISOString(),
    recommendations: [
      "12 Storage Accounts protegidas con detección de anomalías.",
      "Revisar la retención de logs (puede impactar en Data Lake Storage costs).",
    ],
  },
  {
    planId: "defender-containers",
    planName: "Containers",
    name: "Defender for Containers",
    planType: "Containers",
    pricingTier: "Standard",
    subscriptionId: "sub-123",
    subscriptionName: "Production",
    estimatedMonthlyCost: 156.00,
    resourcesCovered: 8,
    protectionStatus: "Full",
    lastUpdated: new Date().toISOString(),
    recommendations: [
      "8 registros de contenedor (ACR) bajo vigilancia.",
      "Asegura que el agente de Defender esté presente en todos los nodos del clúster Kubernetes.",
    ],
  },
  {
    planId: "defender-sql",
    planName: "SqlServers",
    name: "Defender for SQL Servers",
    planType: "SQL",
    pricingTier: "Standard",
    subscriptionId: "sub-456",
    subscriptionName: "Development",
    estimatedMonthlyCost: 45.20,
    resourcesCovered: 3,
    protectionStatus: "Partial",
    lastUpdated: new Date().toISOString(),
    recommendations: [
      "3 SQL Servers detectados, pero solo 2 están protegidos (67%).",
      "Habilitá Defender en el SQL Server restante para cobertura completa.",
    ],
  },
  {
    planId: "defender-cspm",
    planName: "CloudPosture",
    name: "Defender CSPM (Cloud Security Posture Management)",
    planType: "CSPM",
    pricingTier: "Free",
    subscriptionId: "sub-123",
    subscriptionName: "Production",
    estimatedMonthlyCost: 0,
    resourcesCovered: 2,
    protectionStatus: "Full",
    lastUpdated: new Date().toISOString(),
    recommendations: [
      "CSPM Free (siempre incluido) escanea 2 suscripciones.",
      "Para advanced security governance, considera CSPM Standard (incluido en algunos planes).",
    ],
  },
];

async function getDefenderDetailsFromAzure(
  tenantId: string,
  subscriptionIds: string[]
): Promise<DefenderPlanDetail[]> {
  try {
    const credential = await getAzureCredential(tenantId);
    
    // Obtener detalles de planes de Defender por suscripción
    const allPlans: DefenderPlanDetail[] = [];
    const ARM_BASE = "https://management.azure.com";
    const SECURITY_API_VERSION = "2023-01-01";

    // Token para ARM API
    const tokenData = await credential.getToken(`${ARM_BASE}/.default`);
    if (!tokenData) throw new Error("No se pudo obtener el token de Azure Management");
    const token = tokenData.token;

    // Para cada suscripción, consultar planes de Defender
    for (const subscriptionId of subscriptionIds) {
      try {
        const url = `${ARM_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.Security/pricings?api-version=${SECURITY_API_VERSION}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) continue;

        const json: any = await res.json();
        const subsUrl = `${ARM_BASE}/subscriptions/${subscriptionId}?api-version=2020-01-01`;
        const subsRes = await fetch(subsUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const subsJson: any = await subsRes.json();
        const subscriptionName = String(subsJson.displayName || `Subscription-${subscriptionId.slice(0, 8)}`);

        // Mapear cada plan de Defender a DefenderPlanDetail
        for (const item of json.value || []) {
          const props = item.properties || {};
          const planName = String(item.name || "").toLowerCase();
          let planType: DefenderPlanDetail["planType"] = "Other";
          let displayName = "Defender";

          // Mapear al tipo de plan
          if (planName.includes("virtualmachines")) {
            // Detectar Plan 1 vs Plan 2 por subPlan
            const subPlan = String(props.subPlan || "P1").toUpperCase();
            planType = subPlan === "P2" ? "Servers Plan 2" : "Servers Plan 1";
            displayName = `Defender for Servers (${subPlan})`;
          } else if (planName.includes("storageaccounts")) {
            planType = "Storage";
            displayName = "Defender for Storage";
          } else if (planName.includes("containers")) {
            planType = "Containers";
            displayName = "Defender for Containers";
          } else if (planName.includes("sqlservers")) {
            planType = "SQL";
            displayName = "Defender for SQL Servers";
          } else if (planName.includes("cloudposture")) {
            planType = "CSPM";
            displayName = "Defender CSPM";
          } else if (planName.includes("appservices")) {
            planType = "Other";
            displayName = "Defender for App Services";
          } else if (planName.includes("keyvaults")) {
            planType = "Other";
            displayName = "Defender for Key Vaults";
          }

          // Determinar status de cobertura (por ahora: si está en Standard = Full)
          const protectionStatus: DefenderPlanDetail["protectionStatus"] = 
            props.pricingTier === "Standard" ? "Full" : "None";

          allPlans.push({
            planId: `${subscriptionId}/${planName}`,
            planName,
            name: displayName,
            planType,
            pricingTier: props.pricingTier === "Standard" ? "Standard" : "Free",
            subscriptionId,
            subscriptionName,
            estimatedMonthlyCost: 0, // Se actualizará con Cost Management
            resourcesCovered: 0, // Se actualizará con Resource Count
            protectionStatus,
            lastUpdated: new Date().toISOString(),
            recommendations: getRecommendations(planType, props.pricingTier === "Standard"),
          });
        }
      } catch (e) {
        console.warn(`[DefenderDetails] Error querying ${subscriptionId}:`, e instanceof Error ? e.message : e);
      }
    }

    // Si no hay planes encontrados, retornar array vacío (no MOCK_DETAILS)
    if (allPlans.length === 0) {
      return [];
    }

    // Enriquecer con costos reales de Cost Management
    try {
      const costClient = new CostManagementClient(credential);
      for (const subId of subscriptionIds) {
        try {
          const costRes = await costClient.query.usage(`/subscriptions/${subId}`, {
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
                    "Microsoft Defender for Cloud",
                    "Security Center",
                    "Azure Security Center",
                  ],
                },
              },
            },
          });

          const cols = (costRes.columns || []).map((c: any) => String(c.name).toLowerCase());
          const costIdx = cols.indexOf("cost");
          let totalCost = 0;
          for (const row of costRes.rows || []) {
            totalCost += costIdx >= 0 ? Number(row[costIdx]) || 0 : 0;
          }

          // Distribuir costo entre planes de esta suscripción
          const plansInSub = allPlans.filter((p) => p.subscriptionId === subId);
          if (plansInSub.length > 0 && totalCost > 0) {
            const costPerPlan = totalCost / plansInSub.length;
            for (const plan of plansInSub) {
              plan.estimatedMonthlyCost = Number((plan.estimatedMonthlyCost + costPerPlan).toFixed(2));
            }
          }
        } catch (e) {
          console.warn(`[DefenderDetails] Error querying costs for ${subId}:`, e instanceof Error ? e.message : e);
        }
      }
    } catch (e) {
      console.warn(`[DefenderDetails] Cost Management error:`, e instanceof Error ? e.message : e);
    }

    return allPlans;
  } catch (e) {
    console.error(`[DefenderDetails] Fatal error querying Azure for ${tenantId}:`, e instanceof Error ? e.message : e);
    // En producción, retornar error, NO mocks
    throw new Error("No se pudieron obtener los detalles de Defender for Cloud. Intenta más tarde.");
  }
}

function getRecommendations(planType: DefenderPlanDetail["planType"], isStandard: boolean): string[] {
  const recs: string[] = [];
  
  if (!isStandard) {
    recs.push("Este plan está en Free. Considera cambiar a Standard para protección completa.");
  }

  switch (planType) {
    case "Servers Plan 1":
      recs.push("Plan 1 es adecuado para VM tradicionales. Revisa si necesitas Plan 2 para análisis avanzado.");
      break;
    case "Servers Plan 2":
      recs.push("Plan 2 ofrece análisis de comportamiento avanzado. Valida que justifique el costo adicional.");
      break;
    case "Storage":
      recs.push("Defender for Storage monitorea anomalías. Revisa la retención de logs para optimizar costos.");
      break;
    case "Containers":
      recs.push("Asegura que el agente de Defender esté presente en todos los nodos del clúster.");
      break;
    case "SQL":
      recs.push("Defender for SQL incluye evaluación de vulnerabilidades y protección contra inyección SQL.");
      break;
    case "CSPM":
      recs.push("CSPM Free incluye evaluación básica. Considera CSPM Standard para governance avanzado.");
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

    // Si es mock tenant, retorna mock data
    if (isMockTenant(tenantId)) {
      return NextResponse.json({
        success: true,
        mock: true,
        details: MOCK_DETAILS,
        summary: {
          totalEstimatedMonthlyCost: MOCK_DETAILS.reduce((sum, d) => sum + d.estimatedMonthlyCost, 0),
          totalResourcesCovered: MOCK_DETAILS.reduce((sum, d) => sum + d.resourcesCovered, 0),
          defenderTypesEnabled: Array.from(new Set(MOCK_DETAILS.map((d) => d.planType))),
          fullyCovered: MOCK_DETAILS.filter((d) => d.protectionStatus === "Full").length,
          partiallyCovered: MOCK_DETAILS.filter((d) => d.protectionStatus === "Partial").length,
          notCovered: MOCK_DETAILS.filter((d) => d.protectionStatus === "None").length,
        },
      });
    }

    await requireTenantTier(request, tenantId, "Business");

    // Caso real: consultar Azure
    const requestedSubscriptions = searchParams
      .get("subscriptionIds")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) || [];
    const credential = await getAzureCredential(tenantId);
    const subscriptionIds =
      requestedSubscriptions.length > 0
        ? requestedSubscriptions
        : await getSubscriptionsForTenant(tenantId, credential);
    const details = await getDefenderDetailsFromAzure(tenantId, subscriptionIds);

    return NextResponse.json({
      success: true,
      mock: false,
      details,
      summary: {
        totalEstimatedMonthlyCost: details.reduce((sum, d) => sum + d.estimatedMonthlyCost, 0),
        totalResourcesCovered: details.reduce((sum, d) => sum + d.resourcesCovered, 0),
        defenderTypesEnabled: Array.from(new Set(details.map((d) => d.planType))),
        fullyCovered: details.filter((d) => d.protectionStatus === "Full").length,
        partiallyCovered: details.filter((d) => d.protectionStatus === "Partial").length,
        notCovered: details.filter((d) => d.protectionStatus === "None").length,
      },
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("DefenderDetails API Error:", error);
    const errorMessage = error instanceof Error ? error.message : "No se pudieron obtener los detalles de Defender for Cloud";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
