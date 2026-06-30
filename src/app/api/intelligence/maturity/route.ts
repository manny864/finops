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

    const cacheKey = `intelligence:maturity:${tenantId}`;
    const resultData = await getWithStaleWhileRevalidate(cacheKey, async () => {
      // Attempt to get Azure credential for real data
      let credential;
      try {
        credential = await getAzureCredential(tenantId);
      } catch {
        return { data: null, reason: "NO_CREDENTIAL" };
      }

      // Gather real signals from Azure
      let hasSubscriptions = false;
      let totalAdvisorRecs = 0;
      let costRecs = 0;
      let securityRecs = 0;
      let hasBudgets = false;
      let subscriptionCount = 0;

      try {
        const tokenResponse = await credential.getToken("https://management.azure.com/.default");
        const fetchRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
            headers: { "Authorization": `Bearer ${tokenResponse.token}` }
        });
        const data = await fetchRes.json();
        const subs: any[] = data.value || [];
        subscriptionCount = subs.length;
        hasSubscriptions = subs.length > 0;

        if (hasSubscriptions) {
          const firstSub = subs[0];
          
          // 2. Check Advisor recommendations
          try {
            const advisorClient = new AdvisorManagementClient(credential, firstSub.subscriptionId!);
            for await (const rec of advisorClient.recommendations.list()) {
              totalAdvisorRecs++;
              if (rec.category === "Cost") costRecs++;
              if (rec.category === "Security") securityRecs++;
            }
          } catch { /* Advisor not accessible */ }

          // 3. Check budgets exist
          try {
            const consumptionClient = new ConsumptionManagementClient(credential, firstSub.subscriptionId!);
            const scope = `subscriptions/${firstSub.subscriptionId}`;
            for await (const _budget of consumptionClient.budgets.list(scope)) {
              hasBudgets = true;
              break;
            }
          } catch { /* Consumption not accessible */ }
        }
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

      // Calculate real scores based on actual Azure signals
      const VisibilityAndAllocation = Math.min(100,
        30 + (subscriptionCount > 1 ? 20 : 0) +
        (totalAdvisorRecs === 0 ? 30 : Math.max(0, 30 - costRecs * 5)) +
        (hasBudgets ? 20 : 0)
      );
      
      const UsageOptimization = costRecs === 0 ? 100 : Math.max(10, 100 - costRecs * 15);
      const RateOptimization = costRecs === 0 ? 80 : Math.max(10, 80 - costRecs * 10);
      const ForecastingAndBudgeting = hasBudgets ? 80 : 15;
      const GovernanceAndAutomation = securityRecs === 0 ? 85 : Math.max(20, 85 - securityRecs * 10);

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
            [tenantId, 'MaturityAssessmentCompleted', 'Tenant', 'Assessment', 'Success', JSON.stringify({ finalScore, level }), 'system@maturity']
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
