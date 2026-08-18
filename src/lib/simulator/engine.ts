/**
 * Pure simulator math. Extracted from /api/intelligence/simulator/route.ts so
 * the same projection can run on save and compare endpoints without duplicating
 * coefficients, and so it is unit-testable in isolation.
 *
 * Mix assumptions:
 *   compute = 60% · baseCost · computeScale
 *   storage = 25% · baseCost · storageScale
 *   network = 15% · baseCost · (1 + networkIncrease/100)
 *
 * Licencias (Azure Hybrid Benefit): el descuento se aplica SOLO al componente
 * de cómputo. Antes se aplicaba al total, lo que sobreestimaba el ahorro: el
 * AHB no abarata un byte de storage ni un GB de egress — cubre licencias de
 * Windows Server / SQL Server, que se pagan con el cómputo.
 *
 * El porcentaje es un INPUT, no una constante escondida: 18% por defecto (valor
 * histórico de AHB con el que se calibró esta herramienta), y el usuario puede
 * declarar el suyo. Un proveedor sin default calibrado cae a 0 en vez de
 * heredar un número que no le corresponde.
 */

import { toMoneyNumber } from "@/lib/money";

export interface SimulatorInputs {
    /** Compute scale factor — 1 = 100%, 1.5 = +50%. */
    computeScale?: number;
    /** Storage scale factor — 1 = 100%. */
    storageScale?: number;
    /** Network egress increase in percent points (−50..+200). */
    networkIncrease?: number;
    /** Apply license benefit (Azure Hybrid Benefit). */
    applyAhb?: boolean;
    /**
     * Ahorro por licencias, en puntos porcentuales sobre el cómputo (0..100).
     * Si se omite se usa el default del proveedor.
     */
    licenseSavingsPct?: number;
    /** % de cómputo cubierto por Savings Plans / RIs (0..100). Descuento fijo 35% sobre la porción cubierta. */
    savingsPlanCoveragePercent?: number;
    /** % de cómputo en instancias Spot (0..100). Descuento fijo 70% sobre la porción Spot. */
    spotInstancesPercent?: number;
}

/** Proveedores para los que el simulador tiene defaults calibrados. */
export type SimulatorProvider = "azure";

/** Default de ahorro por licencias, en % sobre el cómputo (18 = valor histórico de AHB). */
export const DEFAULT_LICENSE_SAVINGS_PCT: Record<SimulatorProvider, number> = {
    azure: 18,
};

/** Descuentos estimados fijos por modelo de compra de cómputo (no editables — son la premisa del escenario). */
export const SAVINGS_PLAN_DISCOUNT_PCT = 35;
export const SPOT_INSTANCES_DISCOUNT_PCT = 70;

export interface CategoryCostBreakdown {
    compute: number;
    storage: number;
    network: number;
}

export interface SimulatorResult {
    baseCost: number;
    projectedCost: number;
    delta: number;
    deltaPct: number;
    breakdown: CategoryCostBreakdown;
    /** Desglose de delta financiero por pilar — mismo signo que `delta` (negativo = ahorro). */
    savingsBreakdown: {
        computeDelta: number;
        storageDelta: number;
        networkDelta: number;
        /** Ahorro aislado por AHB (excluido de computeDelta para no mezclar "cambio de escala" con "beneficio de licencia"). */
        ahbSavings: number;
        totalNetDelta: number;
        percentageChange: number;
    };
}

const COMPUTE_SHARE = 0.60;
const STORAGE_SHARE = 0.25;
const NETWORK_SHARE = 0.15;

function round2(n: number): number {
    // Reuse money precision (cents) so add/subtract stays exact across runs.
    return toMoneyNumber(n);
}

export function runScenario(
    baseCost: number,
    inputs: SimulatorInputs,
    provider: SimulatorProvider = "azure",
): SimulatorResult {
    if (!Number.isFinite(baseCost) || baseCost <= 0) {
        throw new Error("baseCost debe ser un número > 0");
    }

    const computeScale = Number.isFinite(inputs.computeScale) && (inputs.computeScale as number) >= 0
        ? (inputs.computeScale as number)
        : 1;
    const storageScale = Number.isFinite(inputs.storageScale) && (inputs.storageScale as number) >= 0
        ? (inputs.storageScale as number)
        : 1;
    const networkIncrease = Number.isFinite(inputs.networkIncrease)
        ? (inputs.networkIncrease as number)
        : 0;

    const rawPct = inputs.licenseSavingsPct;
    const licensePct = Number.isFinite(rawPct)
        ? Math.min(100, Math.max(0, rawPct as number))
        : (DEFAULT_LICENSE_SAVINGS_PCT[provider] ?? 0);
    const licenseFactor = inputs.applyAhb ? 1 - licensePct / 100 : 1;

    const savingsPlanCoverage = Number.isFinite(inputs.savingsPlanCoveragePercent)
        ? Math.min(100, Math.max(0, inputs.savingsPlanCoveragePercent as number))
        : 0;
    const spotCoverage = Number.isFinite(inputs.spotInstancesPercent)
        ? Math.min(100, Math.max(0, inputs.spotInstancesPercent as number))
        : 0;
    // Cada punto de cobertura descuenta su tarifa fija sobre esa porción de cómputo;
    // clamp a 0 para el caso extremo (100% SP + 100% Spot) en vez de ir a negativo.
    const commitmentDiscountFactor = Math.max(
        0,
        1 - (savingsPlanCoverage / 100) * (SAVINGS_PLAN_DISCOUNT_PCT / 100) - (spotCoverage / 100) * (SPOT_INSTANCES_DISCOUNT_PCT / 100)
    );

    const computeBeforeAhb = baseCost * COMPUTE_SHARE * computeScale * commitmentDiscountFactor;
    const compute = computeBeforeAhb * licenseFactor;
    const storage = baseCost * STORAGE_SHARE * storageScale;
    const network = baseCost * NETWORK_SHARE * (1 + networkIncrease / 100);

    const projected = compute + storage + network;

    const baseRounded = round2(baseCost);
    const projectedRounded = round2(projected);
    const delta = round2(projectedRounded - baseRounded);
    const deltaPct = baseRounded > 0 ? Math.round((delta / baseRounded) * 1000) / 10 : 0;

    // Desglose por pilar: computeDelta aísla el efecto de escala + SP/Spot,
    // ahbSavings aísla el efecto de la licencia, para que ambos se puedan
    // mostrar por separado en la UI sin que uno se coma al otro.
    const computeBaseline = baseCost * COMPUTE_SHARE;
    const computeDelta = round2(computeBeforeAhb - computeBaseline);
    const ahbSavings = round2(compute - computeBeforeAhb);
    const storageDelta = round2(storage - baseCost * STORAGE_SHARE);
    const networkDelta = round2(network - baseCost * NETWORK_SHARE);

    return {
        baseCost: baseRounded,
        projectedCost: projectedRounded,
        delta,
        deltaPct,
        breakdown: {
            compute: round2(compute),
            storage: round2(storage),
            network: round2(network),
        },
        savingsBreakdown: {
            computeDelta,
            storageDelta,
            networkDelta,
            ahbSavings,
            totalNetDelta: delta,
            percentageChange: deltaPct,
        },
    };
}

/**
 * Validate + sanitise an arbitrary JSON blob into SimulatorInputs.
 * Throws on out-of-range values so we never persist garbage.
 */
export function parseInputs(raw: unknown): SimulatorInputs {
    if (!raw || typeof raw !== "object") throw new Error("inputs inválidos");
    const r = raw as Record<string, unknown>;

    const computeScale = r.computeScale === undefined ? 1 : Number(r.computeScale);
    const storageScale = r.storageScale === undefined ? 1 : Number(r.storageScale);
    const networkIncrease = r.networkIncrease === undefined ? 0 : Number(r.networkIncrease);
    const applyAhb = Boolean(r.applyAhb);
    const licenseSavingsPct = r.licenseSavingsPct === undefined
        ? undefined
        : Number(r.licenseSavingsPct);
    const savingsPlanCoveragePercent = r.savingsPlanCoveragePercent === undefined
        ? undefined
        : Number(r.savingsPlanCoveragePercent);
    const spotInstancesPercent = r.spotInstancesPercent === undefined
        ? undefined
        : Number(r.spotInstancesPercent);

    if (!Number.isFinite(computeScale) || computeScale < 0 || computeScale > 10) {
        throw new Error("computeScale fuera de rango (0..10)");
    }
    if (!Number.isFinite(storageScale) || storageScale < 0 || storageScale > 10) {
        throw new Error("storageScale fuera de rango (0..10)");
    }
    if (!Number.isFinite(networkIncrease) || networkIncrease < -100 || networkIncrease > 500) {
        throw new Error("networkIncrease fuera de rango (-100..500)");
    }

    if (licenseSavingsPct !== undefined
        && (!Number.isFinite(licenseSavingsPct) || licenseSavingsPct < 0 || licenseSavingsPct > 100)) {
        throw new Error("licenseSavingsPct fuera de rango (0..100)");
    }
    if (savingsPlanCoveragePercent !== undefined
        && (!Number.isFinite(savingsPlanCoveragePercent) || savingsPlanCoveragePercent < 0 || savingsPlanCoveragePercent > 100)) {
        throw new Error("savingsPlanCoveragePercent fuera de rango (0..100)");
    }
    if (spotInstancesPercent !== undefined
        && (!Number.isFinite(spotInstancesPercent) || spotInstancesPercent < 0 || spotInstancesPercent > 100)) {
        throw new Error("spotInstancesPercent fuera de rango (0..100)");
    }

    return {
        computeScale, storageScale, networkIncrease, applyAhb, licenseSavingsPct,
        savingsPlanCoveragePercent, spotInstancesPercent,
    };
}
