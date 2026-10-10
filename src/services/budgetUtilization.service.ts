/**
 * Presupuestos con su gasto del mes: lo que muestra la pantalla de Presupuestos (`GET /api/budgets`) y lo que leen
 * las tools del MCP y el feed de Power BI.
 *
 * `Budgets` guarda el límite, no el gasto. El gasto sale de Cost Management (`getBudgetConsumption`), que en prod ya
 * cae a una consulta por suscripción y por presupuesto (el scope de Management Group falla) y es la API que más 429
 * devuelve. Por eso hay UNA sola caché de este dato y este módulo es su dueño: la pantalla, el MCP y el feed leen la
 * misma clave (`budgetsCacheKey`) y quien modifica presupuestos la invalida con ella. Antes el MCP y el feed pedían
 * `Budgets.name` / `amount_usd` / `period` / `actual_spend_usd`, que no existen, y un `catch` los volvía "no hay".
 */
import Decimal from "decimal.js";
import { RowDataPacket } from "mysql2";
import pool from "@/modules/storage/db";
import { getWithStaleWhileRevalidate } from "@/lib/cache";
import { errorMessage } from "@/lib/apiErrors";
import { toMoneyNumber } from "@/lib/moneyDecimal";
import { is429 } from "@/modules/collectors/azure/billing/billingHelpers";
import { getBudgetConsumption, calculateBudgetProjection } from "@/services/budgetService";
import type { BudgetProjection } from "@/lib/budgetTypes";

const BUDGETS_TTL_SECONDS = 3600;
// Si Cost Management no contestó (429 en todas las suscripciones, o cualquier otro fallo), no conviene cachear el $0
// degradado la hora entera (ver mtdBillingService.ts, mismo patrón): el próximo refresh reintenta en 5 min en vez de una hora.
const BUDGETS_DEGRADED_TTL_SECONDS = 300;

/** La clave de caché de los presupuestos de un tenant. `subscriptionId` puede ser `*` para invalidar todas. */
export function budgetsCacheKey(tenantId: string, subscriptionId: string): string {
    return `budgets:${tenantId}:${subscriptionId}`;
}

/** Lo que devuelve `GET /api/budgets` por presupuesto (y lo que se cachea). */
export type BudgetUtilization = Pick<
    BudgetProjection,
    "currentSpend" | "dailyBurnRate" | "forecastedMonthEndSpend" | "forecastedBreachDate" | "budgetStatus"
> & {
    id: number;
    costCenter: string;
    monthlyLimit: number;
    alertThreshold: number;
    utilization: number;
    /** `Budgets.active`. La pantalla muestra todos; el MCP y el feed sólo los activos. */
    active: boolean;
    /**
     * `false` si Cost Management no contestó por este presupuesto: `currentSpend` vale 0 pero NO es su gasto. Sin esta
     * marca un 429 se leía como "0% usado, todo ok".
     */
    spendAvailable: boolean;
};

export async function getBudgetsUtilization(
    tenantId: string,
    subscriptionId: string
): Promise<{ budgets: BudgetUtilization[]; throttled: boolean }> {
    return getWithStaleWhileRevalidate(
        budgetsCacheKey(tenantId, subscriptionId),
        async () => {
            const [rows] = await pool.query<RowDataPacket[]>("SELECT * FROM Budgets WHERE tenant_id = ?", [tenantId]);
            let throttled = false;
            // getBudgetConsumption llama a Azure: cada llamada va aparte para que un error de credenciales o un
            // 429 en un presupuesto no tumbe la lista entera (queda con gasto no disponible).
            const budgets = await Promise.all(
                rows.map(async (b): Promise<BudgetUtilization> => {
                    let currentSpend = 0;
                    let spendAvailable = true;
                    try {
                        currentSpend = await getBudgetConsumption(tenantId, subscriptionId, b.cost_center_tag_value);
                    } catch (consumptionErr) {
                        spendAvailable = false;
                        if (is429(consumptionErr)) throttled = true;
                        console.warn(`[budgets] consumption fetch failed for budget ${b.id}:`, errorMessage(consumptionErr));
                    }
                    const limitDec = new Decimal(b.monthly_limit_usd || 0);
                    const currentSpendDec = new Decimal(currentSpend || 0);
                    const limitNum = toMoneyNumber(limitDec);
                    const currentSpendNum = toMoneyNumber(currentSpendDec);
                    const utilization = limitNum > 0 ? Number(currentSpendDec.dividedBy(limitDec).times(100).toFixed(2)) : 0;
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
                        active: Number(b.active ?? 1) === 1,
                        spendAvailable,
                    };
                })
            );
            return { budgets, throttled };
        },
        BUDGETS_TTL_SECONDS,
        undefined,
        (result) => (result.throttled || result.budgets.some((b) => !b.spendAvailable) ? BUDGETS_DEGRADED_TTL_SECONDS : BUDGETS_TTL_SECONDS)
    );
}

/** Lo que devuelven las tools `get_budgets_status` / `get_budget_status` del MCP y el feed `budgets` de Power BI. */
export interface BudgetStatusRow {
    name: string;
    /** `Budgets` sólo guarda límites mensuales y el gasto es el del mes en curso. */
    period: "monthly";
    budgetUSD: number;
    spentUSD: number | null;
    usagePct: number | null;
    status: "ok" | "warning" | "exceeded" | "unknown";
}

/**
 * Los presupuestos activos del tenant con su % consumido. Si Cost Management no contestó por uno, su gasto, su % y su
 * estado son `null` / `"unknown"` (no 0 ni "ok"). Lanza si no se puede leer la tabla: quien lo muestre tiene que decirlo.
 */
export async function getBudgetStatuses(tenantId: string): Promise<BudgetStatusRow[]> {
    const { budgets } = await getBudgetsUtilization(tenantId, "All");
    return budgets
        .filter((b) => b.active !== false)
        .map((b): BudgetStatusRow => {
            const base = { name: b.costCenter, period: "monthly" as const, budgetUSD: b.monthlyLimit };
            if (b.spendAvailable === false) return { ...base, spentUSD: null, usagePct: null, status: "unknown" };
            const pct = b.monthlyLimit > 0 ? (b.currentSpend / b.monthlyLimit) * 100 : 0;
            return {
                ...base,
                spentUSD: b.currentSpend,
                usagePct: Math.round(pct * 10) / 10,
                status: pct >= 100 ? "exceeded" : pct >= 80 ? "warning" : "ok",
            };
        });
}
