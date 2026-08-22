import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantAccess, requireTenantRole, AuthError } from "@/lib/requestAuth";
import { getBudgetConsumption, calculateBudgetProjection, getDiscoveredCostCenterTags } from "@/services/budgetService";
// RBAC: GET requiere pertenencia al tenant (read). POST (crear/actualizar budget)
// requiere rol Admin/Owner — es un control de gobernanza financiera.
import { getWithStaleWhileRevalidate, invalidateCachePattern } from "@/lib/cache";
import { is429 } from "@/modules/collectors/azure/billing/billingHelpers";
import Decimal from "decimal.js";
import { toMoneyNumber } from "@/lib/moneyDecimal";
import { errorMessage } from '@/lib/apiErrors';

const BUDGETS_TTL_SECONDS = 3600;
// Si Cost Management tiró 429 en todas las suscripciones, no conviene cachear
// el $0 degradado la hora entera (ver mtdBillingService.ts, mismo patrón):
// el próximo refresh del usuario reintenta en 5 min en vez de una hora.
const BUDGETS_DEGRADED_TTL_SECONDS = 300;

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
        const { budgets: budgetsWithUtilization } = await getWithStaleWhileRevalidate(cacheKey, async () => {
            let throttled = false;
            const budgets = await Promise.all(rows.map(async (b: any) => {
                let currentSpend = 0;
                try {
                    currentSpend = await getBudgetConsumption(tenantId!, subscriptionId, b.cost_center_tag_value);
                } catch (consumptionErr) {
                    if (is429(consumptionErr)) throttled = true;
                    console.warn(`[budgets] consumption fetch failed for budget ${b.id}:`, errorMessage(consumptionErr));
                }
                const limitDec = new Decimal(b.monthly_limit_usd || 0);
                const currentSpendDec = new Decimal(currentSpend || 0);
                const limitNum = toMoneyNumber(limitDec);
                const currentSpendNum = toMoneyNumber(currentSpendDec);
                const utilization = limitNum > 0
                    ? Number(currentSpendDec.dividedBy(limitDec).times(100).toFixed(2))
                    : 0;
                const proj = calculateBudgetProjection(limitNum, currentSpendNum);
                return {
                    id: b.id,
                    costCenter: b.cost_center_tag_value,
                    monthlyLimit: limitNum,
                    alertThreshold: toMoneyNumber(new Decimal(b.alert_threshold || 0)),
                    currentSpend: currentSpendNum,
                    utilization,
                    dailyBurnRate: proj.dailyBurnRate,
                    forecastedMonthEndSpend: proj.forecastedMonthEndSpend,
                    forecastedBreachDate: proj.forecastedBreachDate,
                    budgetStatus: proj.budgetStatus,
                };
            }));
            return { budgets, throttled };
        }, BUDGETS_TTL_SECONDS, undefined, (result) => result.throttled ? BUDGETS_DEGRADED_TTL_SECONDS : BUDGETS_TTL_SECONDS);

        const suggestedCostCenters = await getDiscoveredCostCenterTags(tenantId);

        return NextResponse.json({
            budgets: budgetsWithUtilization,
            suggestedCostCenters,
        });

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
