import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { getAzureCredential } from "@/lib/azure";
import { SubscriptionClient } from "@azure/arm-subscriptions";
import { AdvisorManagementClient } from "@azure/arm-advisor";
import { ConsumptionManagementClient } from "@azure/arm-consumption";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as any;

    if (!decoded || !decoded.tid) {
      return NextResponse.json({ error: "Estructura de token inválida." }, { status: 401 });
    }

    // Attempt to get Azure credential for real data
    let credential;
    try {
      credential = await getAzureCredential(tenantId);
    } catch {
      return NextResponse.json({ data: null, reason: "NO_CREDENTIAL" });
    }

    // Gather real signals from Azure
    let hasSubscriptions = false;
    let totalAdvisorRecs = 0;
    let costRecs = 0;
    let securityRecs = 0;
    let hasBudgets = false;
    let subscriptionCount = 0;

    try {
      // 1. Check subscriptions exist
      const subClient = new SubscriptionClient(credential);
      const subs: any[] = [];
      for await (const sub of subClient.subscriptions.list()) {
        subs.push(sub);
      }
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
      const msg = err?.message || '';
      if (msg.includes('AADSTS7000229')) {
        return NextResponse.json({ data: null, reason: "MISSING_ADMIN_CONSENT" });
      }
      return NextResponse.json({ data: null, reason: "AZURE_ERROR" });
    }

    // If no subscriptions at all, there's nothing to score
    if (!hasSubscriptions) {
      return NextResponse.json({ data: null, reason: "NO_SUBSCRIPTIONS" });
    }

    // Calculate real scores based on actual Azure signals
    // Visibility & Allocation: subscriptions organized, budgets, cost recs
    const VisibilityAndAllocation = Math.min(100,
      30 + (subscriptionCount > 1 ? 20 : 0) +
      (totalAdvisorRecs === 0 ? 30 : Math.max(0, 30 - costRecs * 5)) +
      (hasBudgets ? 20 : 0)
    );
    
    // Usage Optimization: Fewer cost recommendations = better
    const UsageOptimization = costRecs === 0 ? 100 : Math.max(10, 100 - costRecs * 15);
    
    // Rate Optimization: Based on cost recommendations presence
    const RateOptimization = costRecs === 0 ? 80 : Math.max(10, 80 - costRecs * 10);
    
    // Forecasting & Budgeting: Do budgets exist?
    const ForecastingAndBudgeting = hasBudgets ? 80 : 15;
    
    // Governance & Automation: Security recs impact
    const GovernanceAndAutomation = securityRecs === 0 ? 85 : Math.max(20, 85 - securityRecs * 10);

    const overallScore = Math.floor(
      (VisibilityAndAllocation + UsageOptimization + RateOptimization + ForecastingAndBudgeting + GovernanceAndAutomation) / 5
    );

    return NextResponse.json({ 
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
    });

  } catch (error: any) {
    console.error("Maturity API Error:", error);
    return NextResponse.json({ error: "Fallo en la validación de madurez." }, { status: 500 });
  }
}
