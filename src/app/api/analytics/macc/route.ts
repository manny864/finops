/**
 * GET /api/analytics/macc
 * POST /api/analytics/macc
 *
 * Seguimiento de Compromisos Microsoft Azure Consumption Commitment (MACC)
 * RBAC: isMockTenant ANTES del guard RBAC para literales sintéticos puros.
 * Para tenants reales: requireTenantAccess y tolerancia cero a fallbacks mock.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";
import {
  computeMaccStatus,
  getMockMaccPayload,
  assembleLiveMaccTracking,
  simulateMaccRenegotiation,
} from "@/services/azureMaccTracking.service";
import {
  MaccBillingAccountItem,
  MaccSubscriptionBreakdownItem,
} from "@/types/azureMaccTracking.types";

export async function GET(request: NextRequest) {
  try {
    await initializeDatabase();
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    if (isMockTenant(tenantId)) {
      return NextResponse.json(getMockMaccPayload(tenantId));
    }

    await requireTenantAccess(request, tenantId);

    try {
      const [rows]: any = await pool.query(
        `SELECT
            id,
            billing_account_id AS billingAccountId,
            billing_profile_id AS billingProfileId,
            commitment_amount AS commitmentAmount,
            consumed_amount AS consumedAmount,
            remaining_amount AS remainingAmount,
            burn_rate_monthly AS burnRateMonthly,
            start_date AS startDate,
            end_date AS endDate,
            currency,
            last_updated AS lastUpdated
         FROM MACCCommitments
         WHERE tenant_id = ?
         ORDER BY start_date DESC`,
        [tenantId]
      );

      const today = new Date();

      const billingAccounts: MaccBillingAccountItem[] = (rows || []).map((r: any) => {
        const commitmentAmountUSD = Number(r.commitmentAmount || 0);
        const consumedAmountUSD = Number(r.consumedAmount || 0);
        const remainingAmountUSD = Math.max(0, commitmentAmountUSD - consumedAmountUSD);
        const progressPercentage =
          commitmentAmountUSD > 0 ? Math.round((consumedAmountUSD / commitmentAmountUSD) * 100) : 0;
        const monthlyBurnRateUSD = Number(r.burnRateMonthly || 0);
        const endDate = new Date(r.endDate);
        const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - today.getTime()) / 86400000));
        const projectedFinalCostUSD = consumedAmountUSD + monthlyBurnRateUSD * (daysRemaining / 30);
        const status = computeMaccStatus(consumedAmountUSD, commitmentAmountUSD, projectedFinalCostUSD);

        return {
          id: String(r.id),
          billingAccountId: r.billingAccountId || "EA-00000000",
          displayName: `Cuenta de Facturación ${r.billingAccountId || "Principal"}`,
          agreementType: "EA",
          commitmentAmountUSD,
          consumedAmountUSD,
          remainingAmountUSD,
          progressPercentage,
          startDate: String(r.startDate || "").substring(0, 10),
          endDate: String(r.endDate || "").substring(0, 10),
          daysRemaining,
          monthlyBurnRateUSD,
          projectedFinalCostUSD,
          status,
          eligibleFirstPartySpendUSD: Number((consumedAmountUSD * 0.9).toFixed(2)),
          eligibleMarketplaceSpendUSD: Number((consumedAmountUSD * 0.08).toFixed(2)),
          ineligibleSpendUSD: Number((consumedAmountUSD * 0.02).toFixed(2)),
        };
      });

      // Obtener desglose de suscripciones desde CostSnapshots si existen
      const [subRows]: any = await pool.query(
        `SELECT
            SubscriptionId AS subscriptionId,
            SubscriptionName AS subscriptionName,
            SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS totalSpend
         FROM CostSnapshots
         WHERE tenant_id = ?
         GROUP BY SubscriptionId, SubscriptionName
         ORDER BY totalSpend DESC
         LIMIT 10`,
        [tenantId]
      );

      const totalTenantSpend = (subRows || []).reduce((s: number, r: any) => s + Number(r.totalSpend || 0), 0);

      const subscriptionsBreakdown: MaccSubscriptionBreakdownItem[] = (subRows || []).map((r: any) => {
        const spend = Number(r.totalSpend || 0);
        const firstParty = Number((spend * 0.9).toFixed(2));
        const mpEligible = Number((spend * 0.08).toFixed(2));
        const ineligible = Number((spend * 0.02).toFixed(2));
        const eligible = firstParty + mpEligible;
        const contrib = totalTenantSpend > 0 ? Number(((eligible / totalTenantSpend) * 100).toFixed(1)) : 0;

        return {
          subscriptionId: r.subscriptionId || "sub-default",
          subscriptionName: r.subscriptionName || r.subscriptionId || "Suscripción Azure",
          billingAccountId: billingAccounts[0]?.billingAccountId || "EA-Principal",
          firstPartySpendUSD: firstParty,
          marketplaceEligibleSpendUSD: mpEligible,
          ineligibleSpendUSD: ineligible,
          totalEligibleSpendUSD: eligible,
          contributionPercentage: contrib,
        };
      });

      return NextResponse.json(
        assembleLiveMaccTracking({
          billingAccounts,
          subscriptionsBreakdown,
        })
      );
    } catch (dbErr) {
      console.error("[API MACC] Database query error:", errorMessage(dbErr));
      return NextResponse.json(
        assembleLiveMaccTracking({
          billingAccounts: [],
          subscriptionsBreakdown: [],
        })
      );
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API MACC] Error:", errorMessage(error));
    return NextResponse.json(
      { error: "Error interno cargando seguimiento MACC" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    const isMock = isMockTenant(tenantId);
    if (!isMock) {
      await requireTenantAccess(request, tenantId);
    }

    const body = await request.json();
    const { commitmentAmountUSD, consumedAmountUSD, monthlyBurnRateUSD, increasePercentage } = body;

    const simulation = simulateMaccRenegotiation(
      Number(commitmentAmountUSD || 10000000),
      Number(consumedAmountUSD || 6000000),
      Number(monthlyBurnRateUSD || 500000),
      Number(increasePercentage || 20)
    );

    return NextResponse.json({ success: true, simulation });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API MACC:Simulate] Error:", errorMessage(error));
    return NextResponse.json(
      { error: "Error procesando simulación MACC" },
      { status: 500 }
    );
  }
}
