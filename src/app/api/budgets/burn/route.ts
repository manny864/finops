import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getBudgetConsumption } from "@/services/budgetService";
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const subscriptionId = url.searchParams.get("subscriptionId");
        
        if (!tenantId || !subscriptionId) {
            return NextResponse.json({ error: "Faltan tenantId o subscriptionId." }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        const [rows] = await pool.query(
            "SELECT cost_center_name, monthly_budget_usd FROM CostCenterBudgets WHERE tenant_id = ?",
            [tenantId]
        );

        const budgets = rows as any[];
        
        const burnData = await Promise.all(budgets.map(async (b) => {
            const actualCost = await getBudgetConsumption(tenantId, subscriptionId, b.cost_center_name);
            return {
                costCenter: b.cost_center_name,
                budget: parseFloat(b.monthly_budget_usd),
                actual: actualCost
            };
        }));

        return NextResponse.json({ burnData });

    } catch (e: any) {
        return NextResponse.json({ error: "Error interno", details: e.message }, { status: 500 });
    }
}
