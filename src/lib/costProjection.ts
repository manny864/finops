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
    /** Límite superior del cono de incertidumbre (~P90), redondeado a 2 decimales. */
    upperBound: number;
    /** Límite inferior del cono de incertidumbre (~P10), redondeado a 2 decimales (nunca negativo). */
    lowerBound: number;
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

/** Parámetros de entrada del motor de proyección — tipado explícito para callers externos (API routes, tests). */
export interface ForecastCalculationParams {
    monthlyHistory: MonthlyCostPoint[];
    /** % de crecimiento anual (puede ser negativo). */
    annualGrowthPct: number;
    monthsAhead: number;
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

    // Excluir el mes calendario EN CURSO de la base: es un mes parcial y
    // entrarlo al promedio como si fuera completo distorsiona la proyección
    // hacia abajo (y hacia arriba el primer día del mes con datos live).
    // Solo se mantiene si es el ÚNICO dato disponible.
    const currentMonth = new Date().toISOString().slice(0, 7);
    const completed = sorted.filter((p) => p.month < currentMonth);
    const usable = completed.length > 0 ? completed : sorted;
    const trailing12 = usable.slice(-12);

    const trailing12mTotalDec = trailing12.reduce(
        (acc, p) => acc.plus(new Decimal(p.cost || 0)),
        new Decimal(0)
    );
    const monthsUsedForBase = Math.max(trailing12.length, 1);
    const baseMonthlyAverageDec = trailing12mTotalDec.dividedBy(monthsUsedForBase);

    // Coeficiente de variación (volatilidad relativa) del trailing 12m — sirve
    // para el ancho del cono de incertidumbre. Sin desvío calculable (0 o 1
    // mes de historia) cae a un mínimo conservador de 5%.
    const varianceDec = trailing12.length > 1
        ? trailing12.reduce((acc, p) => {
            const diff = new Decimal(p.cost || 0).minus(baseMonthlyAverageDec);
            return acc.plus(diff.times(diff));
        }, new Decimal(0)).dividedBy(trailing12.length)
        : new Decimal(0);
    const stdDevDec = varianceDec.sqrt();
    const coefficientOfVariation = baseMonthlyAverageDec.greaterThan(0)
        ? Decimal.max(stdDevDec.dividedBy(baseMonthlyAverageDec), new Decimal(0.05))
        : new Decimal(0.05);
    // z ~ 1.2816 = z-score de un cono de confianza del 80% (P10/P90).
    const Z_80 = new Decimal(1.2816);

    // (1 + g_anual)^(1/12) - 1, con Decimal.pow que soporta exponentes fraccionarios.
    const annualGrowthFactor = new Decimal(1).plus(new Decimal(annualGrowthPct).dividedBy(100));
    const monthlyGrowthFactor = annualGrowthFactor.pow(new Decimal(1).dividedBy(12));
    const monthlyGrowthRateDec = monthlyGrowthFactor.minus(1);

    const lastMonth = sorted.length > 0 ? sorted[sorted.length - 1].month : new Date().toISOString().slice(0, 7);
    // Ancla t0 (Projection Stitching): el primer mes proyectado parte del
    // ÚLTIMO GASTO REAL conocido, no del promedio de 12m — antes arrancaba
    // desde `baseMonthlyAverageDec`, lo que producía un salto visual/numérico
    // en el empalme (ej. proyección en $45 cuando el último mes real fue $50).
    const lastRealCostDec = sorted.length > 0 ? new Decimal(sorted[sorted.length - 1].cost || 0) : baseMonthlyAverageDec;

    const projection: ProjectedMonthPoint[] = [];
    let runningTotal = new Decimal(0);
    let cursor = lastRealCostDec;
    for (let i = 1; i <= Math.max(1, Math.round(monthsAhead)); i++) {
        cursor = cursor.times(monthlyGrowthFactor);
        const month = addMonths(lastMonth, i);
        const rounded = Number(cursor.toFixed(2));
        // La incertidumbre crece con la raíz del horizonte (supuesto de random
        // walk: la varianza se acumula linealmente mes a mes).
        const spreadDec = cursor.times(coefficientOfVariation).times(Z_80).times(new Decimal(i).sqrt());
        const upperBound = Number(cursor.plus(spreadDec).toFixed(2));
        const lowerBound = Number(Decimal.max(cursor.minus(spreadDec), new Decimal(0)).toFixed(2));
        projection.push({ month, projectedCost: rounded, upperBound, lowerBound });
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

export interface DailySpendHistogramPoint {
    /** "YYYY-MM-DD" */
    date: string;
    cost: number;
    isWeekend: boolean;
    /** Media móvil de 7 días terminando en este día (redondeada a 2 decimales). */
    movingAverage7d: number;
    /** true cuando `cost` supera 2x la media móvil de 7 días. */
    isSpike: boolean;
    /** Servicio con mayor gasto ese día, solo cuando se pudo determinar (best-effort). */
    spikeService?: string | null;
}

function parseUtcDate(dateStr: string): Date {
    return new Date(`${dateStr}T00:00:00Z`);
}

function formatUtcDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/**
 * Rellena huecos de fechas faltantes con costo $0 (continuidad estricta del
 * eje X) y calcula media móvil de 7 días + flags de fin de semana / pico
 * (>2x la media móvil). `serviceTopByDate` es best-effort: sólo se puede
 * poblar cuando el gasto diario viene de CostSnapshots (no del backfill de
 * Azure, que no trae desglose por servicio) — ver cost-projection/route.ts.
 */
export function buildDailyHistogram(
    daily: { date: string; cost: number }[],
    serviceTopByDate?: Map<string, string>
): DailySpendHistogramPoint[] {
    const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length === 0) return [];

    const costByDate = new Map<string, number>(sorted.map((p) => [p.date, p.cost || 0]));
    const start = parseUtcDate(sorted[0].date);
    const end = parseUtcDate(sorted[sorted.length - 1].date);

    const continuous: { date: string; cost: number }[] = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const date = formatUtcDate(d);
        continuous.push({ date, cost: costByDate.get(date) ?? 0 });
    }

    return continuous.map((point, idx) => {
        const windowStart = Math.max(0, idx - 6);
        const window = continuous.slice(windowStart, idx + 1);
        const avg = window.reduce((s, p) => s + p.cost, 0) / window.length;
        const dow = parseUtcDate(point.date).getUTCDay(); // 0=domingo, 6=sábado
        const isWeekend = dow === 0 || dow === 6;
        const isSpike = avg > 0 && point.cost > avg * 2;
        return {
            date: point.date,
            cost: Number(point.cost.toFixed(2)),
            isWeekend,
            movingAverage7d: Number(avg.toFixed(2)),
            isSpike,
            spikeService: isSpike ? (serviceTopByDate?.get(point.date) ?? null) : null,
        };
    });
}

export type HistogramGranularity = "daily" | "weekly" | "monthly";

/**
 * Re-agrega un histograma diario ya continuo a granularidad semanal (semanas
 * ISO, lunes a domingo) o mensual, sumando costo y promediando el flag de
 * fin de semana pierde sentido — se descarta en esas granularidades.
 */
export function aggregateHistogramByGranularity(
    points: DailySpendHistogramPoint[],
    granularity: HistogramGranularity
): Array<{ date: string; cost: number }> {
    if (granularity === "daily") return points.map((p) => ({ date: p.date, cost: p.cost }));

    const buckets = new Map<string, number>();
    for (const p of points) {
        let key: string;
        if (granularity === "monthly") {
            key = p.date.slice(0, 7); // YYYY-MM
        } else {
            const d = parseUtcDate(p.date);
            const dow = d.getUTCDay();
            const isoOffset = dow === 0 ? -6 : 1 - dow; // retrocede al lunes de esa semana
            const monday = new Date(d);
            monday.setUTCDate(d.getUTCDate() + isoOffset);
            key = formatUtcDate(monday); // fecha del lunes representa la semana
        }
        buckets.set(key, (buckets.get(key) || 0) + p.cost);
    }
    return Array.from(buckets.entries())
        .map(([date, cost]) => ({ date, cost: Number(cost.toFixed(2)) }))
        .sort((a, b) => a.date.localeCompare(b.date));
}
