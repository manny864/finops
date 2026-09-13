/**
 * Breakeven de compromisos: la parte DETERMINISTA y sin dependencias del
 * simulador (MEJ-16).
 *
 * Vive separada del servicio a proposito. `Commitments.tsx` es un componente
 * de cliente y solo necesita este calculo, pero importar el servicio entero
 * arrastraba `getExchangeQuota` --y con el `@/modules/storage/db`, o sea
 * mysql2-- al bundle del browser. El `await import()` dinamico no alcanza para
 * evitarlo: Turbopack lo sigue igual y el build termina en
 * "Module not found: Can't resolve 'net'/'tls'/'fs'".
 *
 * Regla: lo que importe un componente de cliente no puede tocar la base, ni
 * siquiera detras de un import dinamico.
 */

export interface BreakevenInput {
    paygMonthly: number;
    discount1yrPct?: number; // default 0.38 (38%)
    discount3yrPct?: number; // default 0.62 (62%)
    workloadType?: "compute" | "database" | "general";
}

export interface RecommendedMix {
    savingsPlansPercent: number;
    reservedInstancesPercent: number;
    paygPercent: number;
    projectedAnnualSavingsUSD: number;
    explanation: string;
}

export interface BreakevenResult {
    paygMonthly: number;
    ri1yrMonthly: number;
    ri3yrMonthly: number;
    savingsMonthly1yr: number;
    savingsMonthly3yr: number;
    breakevenMonths1yr: number;
    breakevenMonths3yr: number;
    recommendedMix: RecommendedMix;
}

export interface ExchangeQuotaResult {
    totalLimitUSD: number;
    usedRefundsUSD: number;
    remainingQuotaUSD: number;
    usagePercentage: number;
    isWarning: boolean;
    isCritical: boolean;
    lastRefundDate?: string | null;
}

export const round2 = (n: number) => Math.round(Number(n) * 100) / 100;
export const round1 = (n: number) => Math.round(Number(n) * 10) / 10;


/**
 * Calcula deterministamente el punto de equilibrio (breakeven) en meses
 * entre tarifa PAYG y compromisos a 1 y 3 años, junto con la recomendación de mix.
 */
export function calculateBreakeven(input: BreakevenInput): BreakevenResult {
    const payg = Math.max(0, Number(input.paygMonthly || 0));
    const disc1 = input.discount1yrPct !== undefined ? input.discount1yrPct : 0.38;
    const disc3 = input.discount3yrPct !== undefined ? input.discount3yrPct : 0.62;

    const ri1yrMonthly = round2(payg * (1 - disc1));
    const ri3yrMonthly = round2(payg * (1 - disc3));
    const savingsMonthly1yr = round2(payg - ri1yrMonthly);
    const savingsMonthly3yr = round2(payg - ri3yrMonthly);

    // Breakeven en meses de uso continuo:
    // 1y: 12 * (1 - disc1)
    // 3y: 36 * (1 - disc3)
    const breakeven1 = payg > 0 ? round1(12 * (1 - disc1)) : 0;
    const breakeven3 = payg > 0 ? round1(36 * (1 - disc3)) : 0;

    // Recomendación de Mix Óptimo según tipo de carga
    let spPct = 55;
    let riPct = 30;
    let paygPct = 15;
    let explanation = "Mix estándar: 55% Savings Plans para cómputo flexible, 30% RIs para bases de datos estables y 15% PAYG elástico para absorber picos.";

    if (input.workloadType === "database") {
        spPct = 20;
        riPct = 70;
        paygPct = 10;
        explanation = "Mix optimizado para bases de datos (SQL, Cosmos, Postgres): 70% RIs dedicadas, 20% Savings Plans y 10% PAYG para contingencias.";
    } else if (input.workloadType === "compute") {
        spPct = 70;
        riPct = 15;
        paygPct = 15;
        explanation = "Mix para cómputo elástico (VMs, VMSS, App Services): 70% Savings Plans para movilidad de familias/regiones, 15% RIs y 15% PAYG.";
    }

    const annualSavings = round2(
        ((savingsMonthly1yr * (riPct / 100)) + (savingsMonthly3yr * (spPct / 100))) * 12
    );

    return {
        paygMonthly: payg,
        ri1yrMonthly,
        ri3yrMonthly,
        savingsMonthly1yr,
        savingsMonthly3yr,
        breakevenMonths1yr: breakeven1,
        breakevenMonths3yr: breakeven3,
        recommendedMix: {
            savingsPlansPercent: spPct,
            reservedInstancesPercent: riPct,
            paygPercent: paygPct,
            projectedAnnualSavingsUSD: annualSavings,
            explanation
        }
    };
}
