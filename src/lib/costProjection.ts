import Decimal from "decimal.js";

/**
 * Proyección de gasto cloud a futuro basada en el consumo mensual real de los
 * últimos 12 meses más una tasa de crecimiento anual que el usuario indica.
 *
 * Regla Cero (precisión): todo el cálculo se hace con Decimal.js — nunca con
 * floats — para evitar arrastre de error en montos que después se suman o
 * comparan contra facturación real.
 */

export interface MonthlyCostPoint {
    /** "YYYY-MM" */
    month: string;
    cost: number;
}

export interface ProjectedMonthPoint {
    /** "YYYY-MM" */
    month: string;
    /** Costo proyectado, redondeado a 2 decimales. */
    projectedCost: number;
}

export interface CostProjectionResult {
    /** Gasto mensual promedio de los últimos 12 meses (base de la proyección). */
    baseMonthlyAverage: number;
    /** Suma del gasto real de los últimos 12 meses usados como base. */
    trailing12mTotal: number;
    /** Cantidad de meses reales con datos usados para calcular el promedio. */
    monthsUsedForBase: number;
    /** Tasa de crecimiento mensual equivalente aplicada (compuesta), en %. */
    monthlyGrowthRatePct: number;
    projection: ProjectedMonthPoint[];
    /** Suma de todo el período proyectado. */
    projectedTotal: number;
}

/**
 * Agrupa una serie diaria { date: 'YYYY-MM-DD', cost } en totales mensuales
 * { month: 'YYYY-MM', cost }, ordenados cronológicamente.
 */
export function aggregateDailyToMonthly(daily: { date: string; cost: number }[]): MonthlyCostPoint[] {
    const totals = new Map<string, Decimal>();
    for (const { date, cost } of daily) {
        const month = String(date).slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(month)) continue;
        const prev = totals.get(month) ?? new Decimal(0);
        totals.set(month, prev.plus(new Decimal(cost || 0)));
    }
    return Array.from(totals.entries())
        .map(([month, total]) => ({ month, cost: Number(total.toFixed(2)) }))
        .sort((a, b) => a.month.localeCompare(b.month));
}

function addMonths(yyyyMM: string, delta: number): string {
    const [y, m] = yyyyMM.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Calcula la proyección de gasto para `monthsAhead` meses, partiendo del
 * promedio mensual de los últimos 12 meses de `monthlyHistory` y aplicando
 * `annualGrowthPct` (puede ser negativo, para escenarios de optimización)
 * compuesto mes a mes: growth_mensual = (1 + annual/100)^(1/12) - 1.
 */
export function projectFutureCosts(
    monthlyHistory: MonthlyCostPoint[],
    annualGrowthPct: number,
    monthsAhead: number
): CostProjectionResult {
    const sorted = [...monthlyHistory].sort((a, b) => a.month.localeCompare(b.month));
    const trailing12 = sorted.slice(-12);

    const trailing12mTotalDec = trailing12.reduce(
        (acc, p) => acc.plus(new Decimal(p.cost || 0)),
        new Decimal(0)
    );
    const monthsUsedForBase = Math.max(trailing12.length, 1);
    const baseMonthlyAverageDec = trailing12mTotalDec.dividedBy(monthsUsedForBase);

    // (1 + g_anual)^(1/12) - 1, con Decimal.pow que soporta exponentes fraccionarios.
    const annualGrowthFactor = new Decimal(1).plus(new Decimal(annualGrowthPct).dividedBy(100));
    const monthlyGrowthFactor = annualGrowthFactor.pow(new Decimal(1).dividedBy(12));
    const monthlyGrowthRateDec = monthlyGrowthFactor.minus(1);

    const lastMonth = sorted.length > 0 ? sorted[sorted.length - 1].month : new Date().toISOString().slice(0, 7);

    const projection: ProjectedMonthPoint[] = [];
    let runningTotal = new Decimal(0);
    let cursor = baseMonthlyAverageDec;
    for (let i = 1; i <= Math.max(1, Math.round(monthsAhead)); i++) {
        cursor = cursor.times(monthlyGrowthFactor);
        const month = addMonths(lastMonth, i);
        const rounded = Number(cursor.toFixed(2));
        projection.push({ month, projectedCost: rounded });
        runningTotal = runningTotal.plus(cursor);
    }

    return {
        baseMonthlyAverage: Number(baseMonthlyAverageDec.toFixed(2)),
        trailing12mTotal: Number(trailing12mTotalDec.toFixed(2)),
        monthsUsedForBase,
        monthlyGrowthRatePct: Number(monthlyGrowthRateDec.times(100).toFixed(4)),
        projection,
        projectedTotal: Number(runningTotal.toFixed(2)),
    };
}
