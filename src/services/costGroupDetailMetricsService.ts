import Decimal from "decimal.js";
import pool from "@/modules/storage/db";
import { isUnattributedSubscriptionId } from "@/lib/azureSubscriptionNames";
import { toMoneyNumber } from "@/lib/moneyDecimal";

function lastNMonths(n: number): Array<{ start: Date; end: Date; label: string }> {
  const out: Array<{ start: Date; end: Date; label: string }> = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0, 23, 59, 59));
    out.push({ start, end, label: start.toISOString().slice(0, 7) });
  }
  return out;
}

export async function getCurrentFY(tenantId: string, budget: number, tagFilter: string, params: any[]) {
  const now = new Date();
  const fyStart = `${now.getUTCFullYear()}-01-01`;
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);

  const [rows]: any = await pool.query(
    `SELECT
        SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) >= ? THEN COALESCE(EffectiveCost, BilledCost, cost_usd, 0) ELSE 0 END) AS actualCostToDateFY,
        SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) >= ? THEN COALESCE(EffectiveCost, BilledCost, cost_usd, 0) ELSE 0 END) AS currentMonthActualCost,
        COUNT(DISTINCT CASE WHEN subscription_id NOT IN ('mg-aggregated', 'default') THEN subscription_id END) AS subscriptions,
        COUNT(DISTINCT resource_group) AS resourceGroups
     FROM CostSnapshots WHERE tenant_id = ? AND ${tagFilter}`,
    [fyStart, monthStart, ...params]
  );
  const r = rows?.[0] || {};
  const daysElapsedMonth = Math.max(1, now.getUTCDate());
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const currentMonthActualCostDec = new Decimal(r.currentMonthActualCost || 0);
  const currentMonthForecast = toMoneyNumber(currentMonthActualCostDec.dividedBy(daysElapsedMonth).times(daysInMonth));

  const [subRows]: any = await pool.query(
    `SELECT subscription_id AS name, SUM(COALESCE(EffectiveCost, BilledCost, cost_usd, 0)) AS cost
     FROM CostSnapshots WHERE tenant_id = ? AND ${tagFilter} AND DATE(COALESCE(ChargePeriodStart, date)) >= ?
     GROUP BY subscription_id ORDER BY cost DESC`,
    [...params, monthStart]
  );
  const allSubs = (subRows as any[]).map((s) => ({ name: s.name as string, costDec: new Decimal(s.cost || 0) }));
  const subscriptionBreakdown = allSubs
    .filter((s) => !isUnattributedSubscriptionId(s.name))
    .map((s) => ({ name: s.name, cost: toMoneyNumber(s.costDec) }));
  const unattributedSubscriptionCost = toMoneyNumber(
    allSubs
      .filter((s) => isUnattributedSubscriptionId(s.name))
      .reduce((sum, s) => sum.plus(s.costDec), new Decimal(0))
  );

  return {
    actualCostToDateFY: toMoneyNumber(new Decimal(r.actualCostToDateFY || 0)),
    currentMonthActualCost: toMoneyNumber(currentMonthActualCostDec),
    monthlyBudget: toMoneyNumber(new Decimal(budget || 0)),
    currentMonthForecast,
    subscriptionBreakdown,
    unattributedSubscriptionCost,
    subscriptionsCount: Number(r.subscriptions) || 0,
    resourceGroupsCount: Number(r.resourceGroups) || 0,
  };
}

export async function getMonthlyCostTrend(tenantId: string, budget: number, tagFilter: string, params: any[]) {
  const months = lastNMonths(6);
  const now = new Date();
  const out = [];
  for (const m of months) {
    const [rows]: any = await pool.query(
      `SELECT SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS total
       FROM CostSnapshots WHERE tenant_id = ? AND ${tagFilter} AND COALESCE(ChargePeriodStart, date) BETWEEN ? AND ?`,
      [...params, m.start, m.end]
    );
    const actualDec = new Decimal(rows?.[0]?.total || 0);
    const isCurrentMonth = m.start.getUTCFullYear() === now.getUTCFullYear() && m.start.getUTCMonth() === now.getUTCMonth();
    const daysElapsed = Math.max(1, now.getUTCDate());
    const daysInMonth = new Date(Date.UTC(m.start.getUTCFullYear(), m.start.getUTCMonth() + 1, 0)).getUTCDate();
    const forecast = isCurrentMonth ? toMoneyNumber(actualDec.dividedBy(daysElapsed).times(daysInMonth)) : null;
    out.push({ month: m.label, actual: toMoneyNumber(actualDec), budget: toMoneyNumber(new Decimal(budget || 0)), forecast });
  }
  return out;
}

export async function getAnomalyCount(tenantId: string, tagFilter: string, params: any[]) {
  const [rows]: any = await pool.query(
    `SELECT DATE(COALESCE(ChargePeriodStart, date)) AS d, SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS total
     FROM CostSnapshots WHERE tenant_id = ? AND ${tagFilter} AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
     GROUP BY d`,
    params
  );
  const values = (rows as any[]).map((r) => Number(r.total) || 0);
  if (values.length < 3) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  return stdDev > 0 ? values.filter((v) => (v - mean) / stdDev > 2.5).length : 0;
}

export async function getPeriodComparison(tenantId: string, tagFilter: string, params: any[], budget: number) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const periodEnd = now.toISOString().slice(0, 10);
  const periodStart = new Date(now);
  periodStart.setUTCDate(periodStart.getUTCDate() - 30);
  const prevPeriodEnd = new Date(periodStart);
  prevPeriodEnd.setUTCDate(prevPeriodEnd.getUTCDate() - 1);
  const prevPeriodStart = new Date(prevPeriodEnd);
  prevPeriodStart.setUTCDate(prevPeriodStart.getUTCDate() - 30);

  const [rows]: any = await pool.query(
    `SELECT
        SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) BETWEEN ? AND ? THEN COALESCE(EffectiveCost, cost_usd, 0) ELSE 0 END) AS periodCost,
        SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) BETWEEN ? AND ? THEN COALESCE(EffectiveCost, cost_usd, 0) ELSE 0 END) AS previousPeriodCost,
        SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) BETWEEN ? AND ? THEN COALESCE(EffectiveCost, cost_usd, 0) ELSE 0 END) AS currentFYCost,
        SUM(CASE WHEN DATE(COALESCE(ChargePeriodStart, date)) BETWEEN ? AND ? THEN COALESCE(EffectiveCost, cost_usd, 0) ELSE 0 END) AS previousFYCost
     FROM CostSnapshots WHERE tenant_id = ? AND ${tagFilter}`,
    [
      periodStart.toISOString().slice(0, 10), periodEnd,
      prevPeriodStart.toISOString().slice(0, 10), prevPeriodEnd.toISOString().slice(0, 10),
      `${currentYear}-01-01`, periodEnd,
      `${currentYear - 1}-01-01`, `${currentYear - 1}-12-31`,
      ...params,
    ]
  );
  const r = rows?.[0] || {};
  const periodCost = new Decimal(r.periodCost || 0);
  const previousPeriodCost = new Decimal(r.previousPeriodCost || 0);
  const currentFYCost = new Decimal(r.currentFYCost || 0);
  const previousFYCost = new Decimal(r.previousFYCost || 0);

  const startOfYear = new Date(Date.UTC(currentYear, 0, 1));
  const daysElapsed = Math.max(1, Math.ceil((now.getTime() - startOfYear.getTime()) / 86400000));
  const projectedFYCost = currentFYCost.dividedBy(daysElapsed).times(365);
  const hundred = new Decimal(100);

  return {
    periodCost: toMoneyNumber(periodCost),
    previousPeriodCost: toMoneyNumber(previousPeriodCost),
    periodChangePct: previousPeriodCost.gt(0)
      ? Number(periodCost.minus(previousPeriodCost).dividedBy(previousPeriodCost).times(hundred).toFixed(1))
      : 0,
    projectedFYCost: toMoneyNumber(projectedFYCost),
    previousFYCost: toMoneyNumber(previousFYCost),
    fyChangePct: previousFYCost.gt(0)
      ? Number(projectedFYCost.minus(previousFYCost).dividedBy(previousFYCost).times(hundred).toFixed(1))
      : 0,
    monthlyBudget: toMoneyNumber(new Decimal(budget || 0)),
  };
}

export async function getTopBreakdown(tenantId: string, tagFilter: string, params: any[], column: string, limit = 6) {
  const [rows]: any = await pool.query(
    `SELECT COALESCE(NULLIF(${column}, ''), 'Unknown') AS name, SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS cost
     FROM CostSnapshots WHERE tenant_id = ? AND ${tagFilter} AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
     GROUP BY name ORDER BY cost DESC`,
    params
  );
  const all = (rows as any[])
    .map((r) => ({ name: r.name, costDec: new Decimal(r.cost || 0) }))
    .filter((r) => r.costDec.gt(0));
  const top = all.slice(0, limit);
  const rest = all.slice(limit).reduce((s, r) => s.plus(r.costDec), new Decimal(0));
  const out = top.map((r) => ({ name: r.name, cost: toMoneyNumber(r.costDec) }));
  if (rest.gt(0)) out.push({ name: "Other", cost: toMoneyNumber(rest) });
  return out;
}
