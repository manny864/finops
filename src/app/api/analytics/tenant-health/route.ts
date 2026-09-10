/**
 * GET /api/analytics/tenant-health
 * Composite Health Scoring, Cloud Optimization Index (COIN), Budget Governance & MFA Posture
 *
 * RBAC: isMockTenant ANTES del guard RBAC para literales sintéticos puros.
 * Para tenants reales: requireTenantAccess y tolerancia cero a fallbacks mock.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantTier, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import {
  assembleLiveTenantHealth,
  getMockTenantHealthPayload,
} from "@/services/azureTenantHealth.service";

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    if (isMockTenant(tenantId)) {
      return NextResponse.json(getMockTenantHealthPayload(tenantId));
    }

    await requireTenantTier(request, tenantId, "Enterprise");

    const payload = await getWithStaleWhileRevalidate(
      `tenantHealth:v2:${tenantId}`,
      async () => {
        try {
          const now = new Date();
          const month = now.getMonth() + 1;
          const year = now.getFullYear();

          // 1. Presupuesto y gasto del mes
          const [budgetRows]: any = await pool.query(
            `SELECT budget_usd FROM TenantMonthlyBudgets WHERE tenant_id=? AND budget_month=? AND budget_year=? LIMIT 1`,
            [tenantId, month, year]
          );
          const [spendRows]: any = await pool.query(
            `SELECT SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS spend
             FROM CostSnapshots
             WHERE tenant_id=? AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')`,
            [tenantId]
          );

          const budgetUSD = budgetRows[0]?.budget_usd != null ? Number(budgetRows[0].budget_usd) : null;
          const currentSpendUSD = Number(spendRows[0]?.spend || 0);

          // 2. Credenciales por expirar (ventana 30 días)
          const [credRows]: any = await pool.query(
            `SELECT COUNT(*) AS cnt FROM ExpiringCredentials
             WHERE tenant_id=? AND expires_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 30 DAY)`,
            [tenantId]
          );
          const expiringCredsCount = Number(credRows[0]?.cnt || 0);

          // 3. COIN: Recomendaciones implementadas vs total
          const [coinRows]: any = await pool.query(
            `SELECT
                SUM(CASE WHEN status='implemented' THEN 1 ELSE 0 END) AS implemented,
                COUNT(*) AS total
             FROM RecommendationActions
             WHERE tenant_id=? AND updated_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 90 DAY)`,
            [tenantId]
          );
          const coinTotal = Number(coinRows[0]?.total || 0);
          const coinImplemented = Number(coinRows[0]?.implemented || 0);

          // 4. MFA en administradores
          const [mfaRows]: any = await pool.query(
            `SELECT SUM(CASE WHEN mfa_enabled=1 THEN 1 ELSE 0 END) AS withMfa, COUNT(*) AS total
             FROM Users WHERE tenant_id=? AND role IN ('Admin', 'Owner', 'GlobalAdmin')`,
            [tenantId]
          );
          const totalAdmins = Number(mfaRows[0]?.total || 0);
          const adminsWithMfa = Number(mfaRows[0]?.withMfa || 0);

          return assembleLiveTenantHealth({
            budgetUSD,
            currentSpendUSD,
            expiringCredsCount,
            coinImplemented,
            coinTotal,
            adminsWithMfa,
            totalAdmins,
          });
        } catch (err) {
          console.error("[API Tenant Health] Live assembly error:", errorMessage(err));
          return assembleLiveTenantHealth({
            budgetUSD: null,
            currentSpendUSD: 0,
            expiringCredsCount: 0,
            coinImplemented: 0,
            coinTotal: 0,
            adminsWithMfa: 0,
            totalAdmins: 0,
          });
        }
      },
      300 // 5 minutos de cache
    );

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API Tenant Health] Error:", errorMessage(error));
    return NextResponse.json(
      { error: "Error interno procesando la salud del tenant" },
      { status: 500 }
    );
  }
}
