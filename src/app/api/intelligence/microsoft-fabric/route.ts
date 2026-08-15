import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";

interface FabricArtefact {
  type: "dataFactory" | "synapse" | "dataWarehouse" | "powerBI" | "realtimeIntel";
  name: string;
  workspace: string;
  capacitySKU: "F64" | "F128" | "F256" | "F512" | "P1" | "P2" | "P3";
  monthlyCostUSD: number;
  capacityUtilizationPercent: number;
  peakDayUtilizationPercent: number;
  burstingRiskPercent: number;
  estimatedWasteUSD: number;
  dataStoredGB: number;
  recommendation?: string;
}

interface FabricMetrics {
  success: boolean;
  mock: boolean;
  artefacts: FabricArtefact[];
  capacitySummary: {
    totalSKUCostUSD: number;
    totalComputeCUHoursUSD: number;
    totalStorageUSD: number;
    forecastEomUSD: number;
    burstingDetected: boolean;
    throttlingRiskLevel: "low" | "medium" | "high";
  };
  onelakeMetrics: {
    totalStorageGB: number;
    duplicateDataGB: number;
    recommendedLifecycleGB: number;
    potentialSavingsUSD: number;
  };
  recommendations: Array<{
    id: string;
    title: string;
    impact: "savings" | "performance" | "reliability";
    potentialSavingsUSD: number;
    effort: "low" | "medium" | "high";
    roiMonths: number;
  }>;
  timestamp: string;
}

const MOCK_FABRIC_METRICS: FabricMetrics = {
  success: true,
  mock: true,
  artefacts: [
    {
      type: "dataFactory",
      name: "etl-prod-factory",
      workspace: "prod-analytics",
      capacitySKU: "F256",
      monthlyCostUSD: 8500,
      capacityUtilizationPercent: 62,
      peakDayUtilizationPercent: 78,
      burstingRiskPercent: 15,
      estimatedWasteUSD: 1200,
      dataStoredGB: 450,
      recommendation: "Optimize pipeline parallelism during peak hours (9am-6pm UTC). Current schedule causes 78% peak util.",
    },
    {
      type: "synapse",
      name: "synapse-warehouse-dev",
      workspace: "dev-analytics",
      capacitySKU: "F128",
      monthlyCostUSD: 3600,
      capacityUtilizationPercent: 18,
      peakDayUtilizationPercent: 35,
      burstingRiskPercent: 5,
      estimatedWasteUSD: 2400,
      dataStoredGB: 200,
      recommendation: "Low utilization (18%). Consolidate with prod or schedule pause during off-hours.",
    },
    {
      type: "dataWarehouse",
      name: "dw-analytics-prod",
      workspace: "prod-analytics",
      capacitySKU: "F512",
      monthlyCostUSD: 18200,
      capacityUtilizationPercent: 71,
      peakDayUtilizationPercent: 92,
      burstingRiskPercent: 42,
      estimatedWasteUSD: 1800,
      dataStoredGB: 1850,
      recommendation: "HIGH PRIORITY: 92% peak utilization. Imminent throttling risk. Upgrade to P1 or optimize queries.",
    },
    {
      type: "powerBI",
      name: "powerbi-reports-prod",
      workspace: "prod-analytics",
      capacitySKU: "F64",
      monthlyCostUSD: 2400,
      capacityUtilizationPercent: 45,
      peakDayUtilizationPercent: 68,
      burstingRiskPercent: 22,
      estimatedWasteUSD: 350,
      dataStoredGB: 120,
      recommendation: "Enable Premium Gen2 auto-pause during off-business hours (8pm-6am UTC).",
    },
    {
      type: "realtimeIntel",
      name: "rti-events-prod",
      workspace: "prod-analytics",
      capacitySKU: "F128",
      monthlyCostUSD: 4500,
      capacityUtilizationPercent: 84,
      peakDayUtilizationPercent: 96,
      burstingRiskPercent: 67,
      estimatedWasteUSD: 900,
      dataStoredGB: 380,
      recommendation: "CRITICAL: 96% peak utilization & 67% bursting risk. Event ingestion bursting at 3pm daily. Add F64 capacity or compress event payloads.",
    },
  ],
  capacitySummary: {
    totalSKUCostUSD: 37200,
    totalComputeCUHoursUSD: 8200,
    totalStorageUSD: 1850,
    forecastEomUSD: 47452,
    burstingDetected: true,
    throttlingRiskLevel: "high",
  },
  onelakeMetrics: {
    totalStorageGB: 3000,
    duplicateDataGB: 420,
    recommendedLifecycleGB: 650,
    potentialSavingsUSD: 2150,
  },
  recommendations: [
    {
      id: "fabric-dw-upgrade",
      title: "Upgrade Data Warehouse to P1 Capacity",
      impact: "performance",
      potentialSavingsUSD: 0,
      effort: "low",
      roiMonths: 0,
    },
    {
      id: "fabric-consolidate-f128",
      title: "Consolidate Dev Synapse F128 with Prod",
      impact: "savings",
      potentialSavingsUSD: 3600,
      effort: "high",
      roiMonths: 2,
    },
    {
      id: "fabric-onelake-lifecycle",
      title: "Implement OneLake Lifecycle Policies",
      impact: "savings",
      potentialSavingsUSD: 2150,
      effort: "medium",
      roiMonths: 1,
    },
    {
      id: "fabric-rti-optimization",
      title: "Optimize RTI Event Payload Compression",
      impact: "performance",
      potentialSavingsUSD: 900,
      effort: "medium",
      roiMonths: 1,
    },
    {
      id: "fabric-powerbi-autopause",
      title: "Enable Premium Auto-pause (Off-hours)",
      impact: "savings",
      potentialSavingsUSD: 1200,
      effort: "low",
      roiMonths: 1,
    },
    {
      id: "fabric-dedup-onelake",
      title: "Deduplicate OneLake Storage (420 GB savings)",
      impact: "savings",
      potentialSavingsUSD: 1850,
      effort: "medium",
      roiMonths: 2,
    },
  ],
  timestamp: new Date().toISOString(),
};

function buildEmptyRealFabricMetrics(): FabricMetrics {
  return {
    success: true,
    mock: false,
    artefacts: [],
    capacitySummary: {
      totalSKUCostUSD: 0,
      totalComputeCUHoursUSD: 0,
      totalStorageUSD: 0,
      forecastEomUSD: 0,
      burstingDetected: false,
      throttlingRiskLevel: "low",
    },
    onelakeMetrics: {
      totalStorageGB: 0,
      duplicateDataGB: 0,
      recommendedLifecycleGB: 0,
      potentialSavingsUSD: 0,
    },
    recommendations: [],
    timestamp: new Date().toISOString(),
  };
}

async function fetchRealFabricMetrics(tenantId: string): Promise<FabricMetrics | null> {
  try {
    const [rows]: any = await pool.query(
      `
      SELECT
        resource_name,
        resource_type,
        region,
        SUM(CAST(cost_usd AS DECIMAL(19,2))) as total_cost,
        AVG(CAST(daily_active_hours AS DECIMAL(5,2))) as avg_daily_hours,
        MAX(CAST(daily_active_hours AS DECIMAL(5,2))) as peak_daily_hours
      FROM CostMeterSnapshots
      WHERE tenant_id = ? AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        AND (LOWER(service_name) LIKE '%fabric%' OR LOWER(service_name) LIKE '%synapse%')
      GROUP BY resource_name, resource_type, region
      LIMIT 20
      `,
      [tenantId]
    );

    if (!rows || rows.length === 0) return buildEmptyRealFabricMetrics();

    // ponytail: simplified calculation (full Fabric metrics would need Fabric API)
    const totalCost = rows.reduce((sum: number, r: any) => sum + parseFloat(r.total_cost || 0), 0);
    const avgUtil = rows.reduce((sum: number, r: any) => sum + Math.min(100, (parseFloat(r.avg_daily_hours || 0) / 24) * 100), 0) / rows.length;

    return {
      success: true,
      mock: false,
      artefacts: rows.map((r: any, idx: number) => ({
        type: ["dataFactory", "synapse", "dataWarehouse", "powerBI", "realtimeIntel"][idx % 5],
        name: r.resource_name || `fabric-resource-${idx}`,
        workspace: "prod-workspace",
        capacitySKU: "F256",
        monthlyCostUSD: parseFloat(r.total_cost || 0),
        capacityUtilizationPercent: avgUtil,
        peakDayUtilizationPercent: Math.min(100, (parseFloat(r.peak_daily_hours || 0) / 24) * 100),
        burstingRiskPercent: avgUtil > 80 ? 60 : avgUtil > 60 ? 30 : 10,
        estimatedWasteUSD: avgUtil < 30 ? parseFloat(r.total_cost || 0) * 0.35 : 0,
        dataStoredGB: 0,
      })),
      capacitySummary: {
        totalSKUCostUSD: totalCost * 0.75,
        totalComputeCUHoursUSD: totalCost * 0.15,
        totalStorageUSD: totalCost * 0.1,
        forecastEomUSD: totalCost * 1.2,
        burstingDetected: avgUtil > 75,
        throttlingRiskLevel: avgUtil > 85 ? "high" : avgUtil > 70 ? "medium" : "low",
      },
      onelakeMetrics: {
        totalStorageGB: 0,
        duplicateDataGB: 0,
        recommendedLifecycleGB: 0,
        potentialSavingsUSD: 0,
      },
      recommendations: [],
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error("Error fetching real Fabric metrics:", err);
    return buildEmptyRealFabricMetrics();
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId required" }, { status: 400 });
    }

    await requireTenantAccess(request, tenantId);

    // Demo tenant: return mock data
    if (isMockTenant(tenantId)) {
      return NextResponse.json(MOCK_FABRIC_METRICS);
    }

    // Real tenant: query DB only (no mock fallback)
    const realMetrics = await fetchRealFabricMetrics(tenantId);
    return NextResponse.json(realMetrics || buildEmptyRealFabricMetrics());
  } catch (error: any) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Error in Microsoft Fabric route:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
