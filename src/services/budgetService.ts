import { getAzureCredential } from "@/lib/azure";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { ConsumptionManagementClient } from "@azure/arm-consumption";
import { redis } from "@/lib/redis";
import pool from "@/modules/storage/db";

/**
 * Obtiene el gasto MTD real para una suscripción usando el pipeline de cache:
 * Redis (sub-ms) → MySQL CostSnapshots → 0
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
        for await (const budget of client.budgets.list(scope)) {
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
    try {
        const credential = await getAzureCredential(tenantId);
        const client = new CostManagementClient(credential);
        const scope = subscriptionId === 'All'
            ? `/providers/Microsoft.Management/managementGroups/${tenantId}`
            : `/subscriptions/${subscriptionId}`;

        const res = await client.query.usage(scope, {
            type: "Usage",
            timeframe: "MonthToDate",
            dataset: {
                granularity: "Monthly",
                aggregation: {
                    totalCost: { name: "PreTaxCost", function: "Sum" }
                },
                grouping: [],
                filter: {
                    tags: { name: "CostCenter", operator: "In", values: [costCenterName] }
                }
            }
        });

        if (res.rows && res.rows.length > 0 && res.rows[0].length > 0) {
            return parseFloat(res.rows[0][0] as string);
        }
        return 0;
    } catch (e) {
        console.error(`Error fetching cost for ${costCenterName}:`, e);
        return 0;
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
