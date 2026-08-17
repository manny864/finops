import { NextRequest, NextResponse } from "next/server";
import { getNativeBudgets, calculateBudgetProjection } from "@/services/budgetService";
import { recordDailySnapshotAsync } from "@/services/snapshotService";
import { isMockTenant } from "@/lib/mockData";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";
import { getAzureCredential, getAllSubscriptionsForTenant } from "@/lib/azure";
// RBAC: lectura de burn de presupuestos requiere pertenencia al tenant (JWT validado).

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const subscriptionId = url.searchParams.get("subscriptionId") || "All";
        
        if (!tenantId) {
            return NextResponse.json({ error: "Falta tenantId." }, { status: 400 });
        }

        // Valida el token JWT y que el caller pertenezca al tenant (evita IDOR cross-tenant).
        await requireTenantAccess(request, tenantId);

        const subIds = subscriptionId.toLowerCase() === "all"
            ? await getAllSubscriptionsForTenant(tenantId, await getAzureCredential(tenantId))
            : subscriptionId.split(",").map(s => s.trim()).filter(s => s.length > 0);
        
        const promises = subIds.map(subId => getNativeBudgets(tenantId, subId));
        const results = await Promise.all(promises);
        
        // Flatten array if there are multiple subscriptions
        const rawBurnData = results.flat();

        const burnData = rawBurnData.map((item: any) => {
            const budgetNum = Number(item.budget || 0);
            const actualNum = Number(item.actual || 0);
            const proj = calculateBudgetProjection(budgetNum, actualNum);
            return {
                ...item,
                dailyBurnRate: proj.dailyBurnRate,
                forecastedMonthEndSpend: proj.forecastedMonthEndSpend,
                forecastedBreachDate: proj.forecastedBreachDate,
                budgetStatus: proj.budgetStatus,
                percentageUsed: proj.percentageUsed,
            };
        });

        const totalBudget = burnData.reduce((s: number, b: any) => s + Number(b.budget || 0), 0);
        const totalActual = burnData.reduce((s: number, b: any) => s + Number(b.actual || 0), 0);
        const consolidated = calculateBudgetProjection(totalBudget, totalActual);

        // Write-through de historial diario (best-effort, solo tenants reales).
        if (!isMockTenant(tenantId) && burnData.length > 0) {
            recordDailySnapshotAsync(tenantId, 'budgets', {
                totalBudget: Number(totalBudget.toFixed(2)),
                totalActual: Number(totalActual.toFixed(2)),
                budgetsCount: burnData.length,
            }, subIds.join(","));
        }

        return NextResponse.json({ burnData, consolidated });

    } catch (e: any) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        return NextResponse.json({ error: "Error interno", details: e.message }, { status: 500 });
    }
}
