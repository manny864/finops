import { getAzureCredential, getAllSubscriptionsForTenant } from "@/lib/azure";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { ConsumptionManagementClient } from "@azure/arm-consumption";
import { redis } from "@/lib/redis";
import pool from "@/modules/storage/db";
import { withCostColumn, findCostColumnIndex } from "@/lib/azureCostColumn";
import { is429, withRetry, mapWithConcurrency } from "@/modules/collectors/azure/billing/billingHelpers";
import Decimal from "decimal.js";
import { toMoneyNumber } from "@/lib/moneyDecimal";

import { getCurrentMonthAmortizedCosts } from "@/modules/collectors/azure/billingService";

/**
 * Obtiene el gasto MTD real para una suscripción usando el pipeline de cache:
 * Redis (sub-ms) → MySQL CostSnapshots → Live Azure Cost Management → 0
 */
async function fetchMtdCostForSub(tenantId: string, subscriptionId: string): Promise<number> {
    const ym = new Date().toISOString().slice(0, 7); // YYYY-MM
    // 1. Redis fast path (populated by summary route)
    try {
        const cached = await redis.get(`cost:mtd:v1:${tenantId}:${subscriptionId.toLowerCase()}:${ym}`);
        if (cached && Number(cached) > 0) return Number(cached);
    } catch (_) { /* Redis unavailable, continue */ }

    // 2. MySQL CostSnapshots fallback
    try {
        const [rows]: any = await pool.query(
            `SELECT SUM(COALESCE(EffectiveCost, cost_usd)) AS mtd
             FROM CostSnapshots
             WHERE tenant_id = ?
               AND LOWER(subscription_id) = LOWER(?)
               AND date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
               AND date <= CURDATE()`,
            [tenantId, subscriptionId]
        );
        const val = Number((rows as any[])[0]?.mtd ?? 0);
        if (val > 0) return val;
    } catch (_) { /* DB unavailable */ }

    // 3. Fallback directo a live Azure Cost Management
    try {
        const entries = await getCurrentMonthAmortizedCosts(tenantId, subscriptionId, 'ActualCost');
        if (entries && entries.length > 0) {
            let total = 0;
            for (const e of entries) {
                const c = Number((e as any).EffectiveCost ?? (e as any).BilledCost ?? 0);
                if (Number.isFinite(c)) total += c;
            }
            if (total > 0) {
                try {
                    await redis.setex(`cost:mtd:v1:${tenantId}:${subscriptionId.toLowerCase()}:${ym}`, 900, String(total));
                } catch (_) {}
                return Number(total.toFixed(2));
            }
        }
    } catch (err: any) {
        console.warn(`[budgetService] Live Azure fallback failed for sub ${subscriptionId}:`, err?.message);
    }

    return 0;
}

export async function getNativeBudgets(tenantId: string, subscriptionId: string) {
    let credential;
    let client;
    try {
        credential = await getAzureCredential(tenantId);
        client = new ConsumptionManagementClient(credential, subscriptionId);
    } catch (e) {
        console.warn(`[Budgets] Sin credenciales para tenant ${tenantId}:`, (e as any)?.message);
        return [];
    }
    const scope = `/subscriptions/${subscriptionId}`;

    const budgetsData = [];
    try {
        const now = new Date();
        for await (const budget of client.budgets.list(scope)) {
            const start = budget.timePeriod?.startDate ? new Date(budget.timePeriod.startDate as any) : null;
            const end = budget.timePeriod?.endDate ? new Date(budget.timePeriod.endDate as any) : null;
            const isActiveByDate = (!start || now >= start) && (!end || now <= end);
            if (!isActiveByDate) continue;

            // currentSpend es un campo read-only que Azure calcula para el scope
            // EXACTO del budget (incluyendo su filter por resource group / tags).
            // Reglas de precisión (Regla Cero):
            //  1. Si Azure trae currentSpend (incluso 0), es la verdad → usarlo.
            //  2. Si NO lo trae (null/undefined) y el budget cubre TODA la
            //     suscripción (sin filter), aproximamos con el MTD de la sub.
            //  3. Si NO lo trae pero el budget está FILTRADO (RG/tags), NO
            //     fabricamos con el total de la sub (inflaría el gasto): dejamos
            //     0 y marcamos estimated=false para no confundir.
            const rawSpend = budget.currentSpend?.amount;
            const hasCurrentSpend = rawSpend !== null && rawSpend !== undefined;
            const isWholeSubScope = !budget.filter;

            let actual: number;
            let estimated = false;
            if (hasCurrentSpend) {
                actual = Number(rawSpend);
            } else if (isWholeSubScope) {
                actual = await fetchMtdCostForSub(tenantId, subscriptionId);
                estimated = actual > 0;
            } else {
                actual = 0;
            }

            budgetsData.push({
                subscriptionId: subscriptionId,
                costCenter: budget.name,
                budget: Number(budget.amount ?? 0),
                actual,
                // true cuando `actual` proviene del MTD de la sub y no del
                // currentSpend autoritativo de Azure (para la UI/tooltips).
                estimated,
            });
        }
    } catch (e) {
        console.error(`Error fetching native budgets for scope ${scope}:`, e);
    }
    
    return budgetsData;
}

export async function getBudgetConsumption(tenantId: string, subscriptionId: string, costCenterName: string) {
    const credential = await getAzureCredential(tenantId);
    const client = new CostManagementClient(credential);

    const queryOptions = (col: string) => ({
        type: "Usage",
        timeframe: "MonthToDate",
        dataset: {
            granularity: "Monthly",
            aggregation: {
                totalCost: { name: col, function: "Sum" }
            },
            grouping: [],
            filter: {
                tags: { name: "CostCenter", operator: "In", values: [costCenterName] }
            }
        }
    });

    const readCost = (res: any): number => {
        if (!res?.rows?.length || !res.rows[0]?.length) return 0;
        const costIdx = res.columns ? findCostColumnIndex(res.columns) : -1;
        return toMoneyNumber(new Decimal(String(res.rows[0][costIdx >= 0 ? costIdx : 0] || 0)));
    };

    const isAllScope = subscriptionId === 'All';
    const scope = isAllScope
        ? `/providers/Microsoft.Management/managementGroups/${tenantId}`
        : `/subscriptions/${subscriptionId}`;

    // El scope de Management Group requiere un rol asignado a nivel MG que el
    // script de onboarding NUNCA otorga (los roles son todos a nivel
    // suscripción, ver onboardingScriptTemplate.ts) — para casi todo tenant
    // esta consulta falla con AuthorizationFailed/ManagementGroupNotFound, y
    // antes eso se tragaba silenciosamente como $0 en vez de iterar por
    // suscripción como ya hace mtdBillingService.ts para "Consumo Real".
    try {
        const res = await withCostColumn(tenantId, (col) => withRetry(
            () => client.query.usage(scope, queryOptions(col)),
            { label: `budgets(${isAllScope ? 'MG' : subscriptionId})`, maxRetries: isAllScope ? 0 : 2 }
        ));
        return readCost(res);
    } catch (e: any) {
        if (!isAllScope) {
            console.error(`Error fetching cost for ${costCenterName}:`, e);
            return 0;
        }
        console.warn(`[Budgets] Scope MG falló para tenant ${tenantId} (${e?.code || e?.statusCode || e?.message}), iterando por suscripción...`);
    }

    // Fallback: sumar el costo del Cost Center en cada suscripción visible del
    // tenant (sin el truncamiento por tier de getSubscriptionsForTenant — acá
    // necesitamos TODAS para que el total de "Presupuestos" sea completo).
    const subIds = await getAllSubscriptionsForTenant(tenantId, credential);
    if (subIds.length === 0) return 0;

    let total = new Decimal(0);
    let succeeded = 0;
    let throttled = 0;
    await mapWithConcurrency(subIds, 2, async (subId) => {
        try {
            const res = await withCostColumn(tenantId, (col) => withRetry(
                () => client.query.usage(`/subscriptions/${subId}`, queryOptions(col)),
                { label: `budgets(sub ${subId})`, maxRetries: 2 }
            ));
            total = total.plus(readCost(res));
            succeeded++;
        } catch (subErr: any) {
            if (is429(subErr)) throttled++;
            console.warn(`[Budgets] Consulta de costo fallida para sub ${subId} (${costCenterName}):`, subErr?.message);
        }
    });

    // Si TODAS las suscripciones fallaron por 429, avisamos al caller (en vez
    // de devolver 0 silencioso) para que /api/budgets pueda cachear un TTL
    // corto en lugar de congelar el $0 degradado por una hora entera.
    if (succeeded === 0 && throttled > 0 && subIds.length > 0) {
        const throttleErr = new Error(`Azure Cost Management 429 throttled para todas las suscripciones de ${tenantId}`);
        (throttleErr as any).is429 = true;
        throw throttleErr;
    }

    return toMoneyNumber(total);
}

/**
 * Historial de gasto real mensual (últimos `months` meses) para un Centro de
 * Costos (tag CostCenter), equivalente al gráfico "View Monthly Cost Data"
 * de Azure Cost Management > Budgets, usado en las tarjetas de Presupuestos
 * de Plataforma para mostrar tendencia + línea de presupuesto.
 */
export async function getBudgetCostCenterMonthlyHistory(
    tenantId: string,
    subscriptionId: string,
    costCenterName: string,
    months = 6
): Promise<{ month: string; cost: number }[]> {
    try {
        const credential = await getAzureCredential(tenantId);
        const client = new CostManagementClient(credential);
        const scope = subscriptionId === 'All'
            ? `/providers/Microsoft.Management/managementGroups/${tenantId}`
            : `/subscriptions/${subscriptionId}`;

        const clampedMonths = Math.min(Math.max(1, Math.round(months)), 12);
        const to = new Date();
        const from = new Date();
        from.setMonth(from.getMonth() - (clampedMonths - 1));
        from.setDate(1);

        const res = await withCostColumn(tenantId, (col) => client.query.usage(scope, {
            type: "Usage",
            timeframe: "Custom",
            timePeriod: { from, to } as any,
            dataset: {
                granularity: "Monthly",
                aggregation: {
                    totalCost: { name: col, function: "Sum" }
                },
                grouping: [],
                filter: {
                    tags: { name: "CostCenter", operator: "In", values: [costCenterName] }
                }
            }
        }));

        if (!res.rows || res.rows.length === 0 || !res.columns) return [];

        const costIdx = findCostColumnIndex(res.columns);
        const dateIdx = res.columns.findIndex((c: any) => /usagedate|date/i.test(c?.name || ''));

        const byMonth = new Map<string, Decimal>();
        for (const row of res.rows) {
            const rawDate = String(row[dateIdx >= 0 ? dateIdx : 0]);
            const month = /^\d{8}$/.test(rawDate)
                ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}`
                : rawDate.slice(0, 7);
            if (!/^\d{4}-\d{2}$/.test(month)) continue;
            const cost = new Decimal(String(row[costIdx >= 0 ? costIdx : 0] || 0));
            byMonth.set(month, (byMonth.get(month) || new Decimal(0)).plus(cost));
        }

        return Array.from(byMonth.entries())
            .map(([month, cost]) => ({ month, cost: toMoneyNumber(cost) }))
            .sort((a, b) => a.month.localeCompare(b.month));
    } catch (e) {
        console.error(`Error fetching monthly history for ${costCenterName}:`, e);
        return [];
    }
}

export async function createSubscriptionBudget(credential: any, subscriptionId: string, budgetDetails: { budgetName: string, amount: number, contactEmails: string[], alertThreshold?: number, timeGrain?: string }) {
    const client = new ConsumptionManagementClient(credential, subscriptionId);
    const scope = `/subscriptions/${subscriptionId}`;

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const startDate = `${year}-${month}-01T00:00:00Z`;

    const endYear = year + 5;
    const endDate = `${endYear}-${month}-01T00:00:00Z`;
    
    const customThreshold = budgetDetails.alertThreshold || 80;

    const budgetPayload: any = {
        amount: budgetDetails.amount,
        category: "Cost",
        timeGrain: budgetDetails.timeGrain || "BillingMonth",
        timePeriod: {
            startDate,
            endDate
        },
        notifications: {
            [`Actual_${customThreshold}`]: {
                enabled: true,
                operator: "GreaterThan",
                threshold: customThreshold,
                contactEmails: budgetDetails.contactEmails,
                thresholdType: "Actual"
            },
            Actual_100: {
                enabled: true,
                operator: "GreaterThan",
                threshold: 100,
                contactEmails: budgetDetails.contactEmails,
                thresholdType: "Actual"
            }
        }
    };

    return await client.budgets.createOrUpdate(scope, budgetDetails.budgetName, budgetPayload);
}

export async function deleteSubscriptionBudget(credential: any, subscriptionId: string, budgetName: string) {
    const client = new ConsumptionManagementClient(credential, subscriptionId);
    const scope = `/subscriptions/${subscriptionId}`;
    await client.budgets.delete(scope, budgetName);
}
