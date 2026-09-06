import { NextRequest, NextResponse } from "next/server";
import { requireRequestIdentity, requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import {
  generateMockHistoricalProgress,
  getLiveHistoricalProgress,
} from "@/services/azureHistoricalProgress.service";
import pool from "@/modules/storage/db";
import type { HistoryTimeRange } from "@/types/historicalProgress.types";

// GET Historical data from real Azure Cost Management, Advisor Score, and MySQL Snapshots
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantIdParam = searchParams.get("tenantId") || "";
    const isMock =
      isMockTenant(tenantIdParam) ||
      searchParams.get("mock") === "true" ||
      tenantIdParam.startsWith("demo-") ||
      tenantIdParam.startsWith("mock-");

    const timeRange = (searchParams.get("timeRange") || "90d") as HistoryTimeRange;
    // Mismo criterio que /api/advisor: el parametro manda, y si no viene se usa
    // el Accept-Language del navegador.
    const locale = searchParams.get("locale") || request.headers.get("accept-language") || "es";

    // 1. POLÍTICA DE ORDEN CRÍTICO: Si es tenant Mock / Demo, responder de inmediato sin exigir Entra ID
    if (isMock || !tenantIdParam || tenantIdParam === "default") {
      const mockReport = generateMockHistoricalProgress(timeRange, "Enterprise", locale);
      const legacyData = mockReport.series.map((s) => ({
        scan_date: s.date,
        score: s.maturityScore,
        impacted_resources: Math.max(1, Math.round(s.unallocatedSpendUSD / 300)),
        potential_score_increase: parseFloat(
          Math.max(0, 100 - s.maturityScore).toFixed(1)
        ),
      }));
      return NextResponse.json({ ...mockReport, data: legacyData });
    }

    // 2. Tenant Real / Conectado: Validación obligatoria de RBAC
    const identity = await requireRequestIdentity(request);
    const tenantId = tenantIdParam || identity.tenantId;
    await requireTenantAccess(request, tenantId);

    const liveReport = await getLiveHistoricalProgress(tenantId, timeRange, locale);
    const legacyData = liveReport.series.map((s) => ({
      scan_date: s.date,
      score: s.maturityScore,
      impacted_resources: Math.max(1, Math.round(s.unallocatedSpendUSD / 300)),
      potential_score_increase: parseFloat(
        Math.max(0, 100 - s.maturityScore).toFixed(1)
      ),
    }));

    return NextResponse.json({
      ...liveReport,
      data: legacyData,
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("History API Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST new record (Triggered by automated scanner)
export async function POST(request: NextRequest) {
  try {
    const identity = await requireRequestIdentity(request);
    const tenantId = identity.tenantId;
    const body = await request.json();

    if (
      body.total_wasted_usd === undefined ||
      body.potential_savings_usd === undefined
    ) {
      return NextResponse.json(
        { error: "Parámetros incompletos" },
        { status: 400 }
      );
    }

    const today = new Date().toISOString().split("T")[0];

    await pool.query(
      `INSERT INTO SavingsHistory (tenant_id, scan_date, total_wasted_usd, potential_savings_usd) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE total_wasted_usd = VALUES(total_wasted_usd), potential_savings_usd = VALUES(potential_savings_usd)`,
      [tenantId, today, body.total_wasted_usd, body.potential_savings_usd]
    );

    return NextResponse.json({
      success: true,
      message: "Registro guardado exitosamente.",
    });
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("History POST API Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
