import { NextRequest, NextResponse } from "next/server";
import { getBudgetCostCenterMonthlyHistory } from "@/services/budgetService";
import { isMockTenant } from "@/lib/mockData";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";

/**
 * GET /api/budgets/monthly-history — historial de gasto real mensual (hasta
 * 12 meses) para un Centro de Costos, usado por las tarjetas de Presupuestos
 * de Plataforma para dibujar el gráfico tipo Azure "View Monthly Cost Data"
 * (barras mensuales + línea de presupuesto).
 *
 * RBAC: requireTenantAccess (lectura, cualquier miembro del tenant).
 * Tenants mock: el frontend genera el gráfico client-side, este endpoint no
 * se invoca.
 */
export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const subscriptionId = url.searchParams.get("subscriptionId") || "All";
        const costCenter = url.searchParams.get("costCenter");
        const months = Number(url.searchParams.get("months")) || 6;

        if (!tenantId || !costCenter) {
            return NextResponse.json({ error: "Faltan tenantId o costCenter." }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true, monthlyHistory: [] });
        }

        const monthlyHistory = await getBudgetCostCenterMonthlyHistory(tenantId, subscriptionId, costCenter, months);

        return NextResponse.json({ success: true, mock: false, monthlyHistory });
    } catch (e: any) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[budgets/monthly-history] GET error:", e);
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}
