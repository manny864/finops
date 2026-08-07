import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantAccess, requireTenantRole, AuthError } from "@/lib/requestAuth";
import { getBudgetConsumption } from "@/services/budgetService";
// RBAC: GET requiere pertenencia al tenant (read). POST (crear/actualizar budget)
// requiere rol Admin/Owner — es un control de gobernanza financiera.
import { getWithStaleWhileRevalidate, invalidateCachePattern } from "@/lib/cache";
import Decimal from "decimal.js";
import { toMoneyNumber } from "@/lib/moneyDecimal";

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get("tenantId");
        const subscriptionId = url.searchParams.get("subscriptionId") || "All";
        
        if (!tenantId) {
            return NextResponse.json({ error: "Falta el tenantId." }, { status: 400 });
        }

        await requireTenantAccess(request, tenantId);

        const [rows]: any = await pool.query(
            "SELECT * FROM Budgets WHERE tenant_id = ?",
            [tenantId]
        );

        // Fetch current consumption for each budget (using SWR cache).
        // getBudgetConsumption calls Azure — wrap each call so a credential/throttle
        // error on one budget doesn't crash the whole list (returns 0 gracefully).
        const cacheKey = `budgets:${tenantId}:${subscriptionId}`;
        const budgetsWithUtilization = await getWithStaleWhileRevalidate(cacheKey, async () => {
            return await Promise.all(rows.map(async (b: any) => {
                let currentSpend = 0;
                try {
                    currentSpend = await getBudgetConsumption(tenantId!, subscriptionId, b.cost_center_tag_value);
                } catch (consumptionErr: any) {
                    console.warn(`[budgets] consumption fetch failed for budget ${b.id}:`, consumptionErr?.message);
                }
                const limitDec = new Decimal(b.monthly_limit_usd || 0);
                const currentSpendDec = new Decimal(currentSpend || 0);
                const utilization = limitDec.gt(0)
                    ? Number(currentSpendDec.dividedBy(limitDec).times(100).toFixed(4))
                    : 0;
                return {
                    id: b.id,
                    costCenter: b.cost_center_tag_value,
                    monthlyLimit: toMoneyNumber(limitDec),
                    alertThreshold: toMoneyNumber(new Decimal(b.alert_threshold || 0)),
                    currentSpend: toMoneyNumber(currentSpendDec),
                    utilization,
                };
            }));
        }, 3600);

        return NextResponse.json({ budgets: budgetsWithUtilization });

    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[budgets] GET error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, costCenter, monthlyLimit, alertThreshold = 80.00 } = body;

        if (!tenantId || !costCenter || monthlyLimit === undefined) {
            return NextResponse.json({ error: "Parámetros incompletos" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ['Admin', 'Owner']);

        await pool.query(
            `INSERT INTO Budgets (tenant_id, cost_center_tag_value, monthly_limit_usd, alert_threshold) 
             VALUES (?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE monthly_limit_usd = ?, alert_threshold = ?`,
            [tenantId, costCenter, monthlyLimit, alertThreshold, monthlyLimit, alertThreshold]
        );

        await invalidateCachePattern(`budgets:${tenantId}:*`);

        return NextResponse.json({ success: true, message: "Presupuesto guardado" });

    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[budgets] POST error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, id, costCenter, monthlyLimit, alertThreshold = 80.0 } = body;

        if (!tenantId || !id || !costCenter || monthlyLimit === undefined) {
            return NextResponse.json({ error: "Parámetros incompletos" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        await pool.query(
            `UPDATE Budgets
             SET cost_center_tag_value = ?, monthly_limit_usd = ?, alert_threshold = ?
             WHERE id = ? AND tenant_id = ?`,
            [costCenter, monthlyLimit, alertThreshold, id, tenantId]
        );

        await invalidateCachePattern(`budgets:${tenantId}:*`);
        return NextResponse.json({ success: true, message: "Presupuesto actualizado" });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[budgets] PUT error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, id } = body;

        if (!tenantId || !id) {
            return NextResponse.json({ error: "Parámetros incompletos" }, { status: 400 });
        }

        await requireTenantRole(request, tenantId, ["Admin", "Owner"]);

        await pool.query(
            "DELETE FROM Budgets WHERE id = ? AND tenant_id = ?",
            [id, tenantId]
        );

        await invalidateCachePattern(`budgets:${tenantId}:*`);
        return NextResponse.json({ success: true, message: "Presupuesto eliminado" });
    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[budgets] DELETE error:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
