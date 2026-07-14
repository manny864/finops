import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getAzureCredential } from "@/lib/azure";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { AdvisorManagementClient } from "@azure/arm-advisor";
import { ConsumptionManagementClient } from "@azure/arm-consumption";
import pool from "@/modules/storage/db";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    await requireTenantAccess(request, tenantId);

    const cacheKey = `intelligence:maturity:v2:${tenantId}`;
    const resultData = await getWithStaleWhileRevalidate(cacheKey, async () => {
      // Attempt to get Azure credential for real data
      let credential;
      try {
        credential = await getAzureCredential(tenantId);
      } catch {
        return { data: null, reason: "NO_CREDENTIAL" };
      }

      // Gather real signals from Azure. We aggregate across ALL subscriptions
      // (capped) and, crucially, track whether each data source was actually
      // *accessible*. A source that throws on permission is NOT the same as a
      // source that returned zero findings: treating "no access" as "perfect"
      // made every tenant collapse to an identical constant score.
      const MAX_SUBS_TO_SCAN = 10;
      let hasSubscriptions = false;
      let subscriptionCount = 0;
      let advisorAccessible = false;
      let budgetsAccessible = false;
      let scannedSubs = 0;
      let totalAdvisorRecs = 0;
      let costRecs = 0;
      let securityRecs = 0;
      let hasBudgets = false;
      let budgetCount = 0;

      let subs: any[] = [];
      try {
        const tokenResponse = await credential.getToken("https://management.azure.com/.default");
        const fetchRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
            headers: { "Authorization": `Bearer ${tokenResponse.token}` }
        });
        const data = await fetchRes.json();
        subs = data.value || [];
        subscriptionCount = subs.length;
        hasSubscriptions = subs.length > 0;
      } catch (err: any) {
        console.error("Maturity API Azure Error:", err);
        const msg = err?.message || '';
        if (msg.includes('AADSTS7000229')) {
          return { data: null, reason: "MISSING_ADMIN_CONSENT" };
        }
        return { data: null, reason: "AZURE_ERROR" };
      }

      // If no subscriptions at all, there's nothing to score
      if (!hasSubscriptions) {
        return { data: null, reason: "NO_SUBSCRIPTIONS" };
      }

      const subsToScan = subs.slice(0, MAX_SUBS_TO_SCAN);
      for (const sub of subsToScan) {
        const subId = sub?.subscriptionId;
        if (!subId) continue;
        scannedSubs++;

        // Advisor recommendations (aggregated). Successful enumeration — even
        // with zero results — marks the source as accessible.
        try {
          const advisorClient = new AdvisorManagementClient(credential, subId);
          for await (const rec of advisorClient.recommendations.list()) {
            totalAdvisorRecs++;
            if (rec.category === "Cost") costRecs++;
            if (rec.category === "Security") securityRecs++;
          }
          advisorAccessible = true;
        } catch { /* Advisor not accessible on this subscription */ }

        // Budgets (aggregated).
        try {
          const consumptionClient = new ConsumptionManagementClient(credential, subId);
          for await (const _budget of consumptionClient.budgets.list(`subscriptions/${subId}`)) {
            budgetCount++;
          }
          budgetsAccessible = true;
          if (budgetCount > 0) hasBudgets = true;
        } catch { /* Consumption not accessible on this subscription */ }
      }

      const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
      const denom = Math.max(1, scannedSubs);
      const costDensity = costRecs / denom;      // cost recs per subscription
      const securityDensity = securityRecs / denom;

      // Visibility & Allocation: how much of the environment we can actually
      // observe (multi-sub structure, Advisor reach, budget reach).
      const VisibilityAndAllocation = clamp(
        35 +
        (subscriptionCount > 1 ? 15 : 5) +
        (advisorAccessible ? 20 : 0) +
        (budgetsAccessible ? 10 : 0) +
        (hasBudgets ? 15 : 0)
      );

      // Usage Optimization: fewer outstanding cost recommendations = better,
      // but only measurable when Advisor is accessible. Otherwise neutral.
      const UsageOptimization = advisorAccessible
        ? clamp(100 - costDensity * 12)
        : 50;

      // Rate Optimization: proxy from cost recommendations density.
      const RateOptimization = advisorAccessible
        ? clamp(90 - costDensity * 10)
        : 50;

      // Forecasting & Budgeting: driven by budgets. "Can't confirm" is a
      // conservative low-neutral, distinct from "confirmed none".
      const ForecastingAndBudgeting = !budgetsAccessible
        ? 30
        : hasBudgets
          ? clamp(60 + Math.min(30, budgetCount * 10))
          : 20;

      // Governance & Automation: fewer security recommendations = better,
      // measurable only when Advisor is accessible.
      const GovernanceAndAutomation = advisorAccessible
        ? clamp(90 - securityDensity * 12)
        : 45;

      const overallScore = Math.floor(
        (VisibilityAndAllocation + UsageOptimization + RateOptimization + ForecastingAndBudgeting + GovernanceAndAutomation) / 5
      );

      return {
        data: {
          overallScore,
          pillars: {
            VisibilityAndAllocation,
            UsageOptimization,
            RateOptimization,
            ForecastingAndBudgeting,
            GovernanceAndAutomation
          },
          signals: {
            subscriptionCount,
            scannedSubs,
            advisorAccessible,
            budgetsAccessible,
            totalAdvisorRecs,
            costRecs,
            securityRecs,
            budgetCount,
          }
        }
      };
    }, 3600);

    return NextResponse.json(resultData);

  } catch (error: unknown) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Maturity API Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, assessmentData } = body;

        if (!tenantId || !assessmentData) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId y assessmentData" }, { status: 400 });
        }

        const identity = await requireTenantAccess(request, tenantId);

        let totalScore = 0;
        let maxScore = 0;
        
        if (Array.isArray(assessmentData)) {
            assessmentData.forEach((item: any) => {
                totalScore += (item.score || 0);
                maxScore += 10;
            });
        }

        const finalScore = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
        
        let level = 'Crawl';
        if (finalScore >= 34 && finalScore <= 66) level = 'Walk';
        if (finalScore >= 67) level = 'Run';

        await pool.query(
            `INSERT INTO MaturityAssessments (tenant_id, score, level, assessment_data) VALUES (?, ?, ?, ?)`,
            [tenantId, finalScore, level, JSON.stringify(assessmentData)]
        );

        await pool.query(
            `INSERT INTO ActionLogs (tenant_id, action_type, resource_id, resource_type, status, details, user_email) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [tenantId, 'MaturityAssessmentCompleted', 'Tenant', 'Assessment', 'Success', JSON.stringify({ finalScore, level }), identity.email || 'system@maturity']
        );

        return NextResponse.json({ 
            success: true, 
            score: finalScore,
            level
        });

    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("Maturity Assessment API Error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
