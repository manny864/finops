/**
 * Pure simulator math. Extracted from /api/intelligence/simulator/route.ts so
 * the same projection can run on save and compare endpoints without duplicating
 * coefficients, and so it is unit-testable in isolation.
 *
 * Mix assumptions (Azure-first baseline):
 *   compute = 60% · baseCost · computeScale
 *   storage = 25% · baseCost · storageScale
 *   network = 15% · baseCost · (1 + networkIncrease/100)
 *
 * AHB (Azure Hybrid Benefit) flat 18% discount on the total when applied.
 */

import { toMoneyNumber } from "@/lib/money";

export interface SimulatorInputs {
    /** Compute scale factor — 1 = 100%, 1.5 = +50%. */
    computeScale?: number;
    /** Storage scale factor — 1 = 100%. */
    storageScale?: number;
    /** Network egress increase in percent points (−50..+200). */
    networkIncrease?: number;
    /** Apply Azure Hybrid Benefit (BYOL Windows / SQL). */
    applyAhb?: boolean;
}

export interface SimulatorResult {
    baseCost: number;
    projectedCost: number;
    delta: number;
    deltaPct: number;
    breakdown: {
        compute: number;
        storage: number;
        network: number;
    };
}

const COMPUTE_SHARE = 0.60;
const STORAGE_SHARE = 0.25;
const NETWORK_SHARE = 0.15;
const AHB_DISCOUNT = 0.82; // 18% off

function round2(n: number): number {
    // Reuse money precision (cents) so add/subtract stays exact across runs.
    return toMoneyNumber(n);
}

export function runScenario(baseCost: number, inputs: SimulatorInputs): SimulatorResult {
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

    const compute = baseCost * COMPUTE_SHARE * computeScale;
    const storage = baseCost * STORAGE_SHARE * storageScale;
    const network = baseCost * NETWORK_SHARE * (1 + networkIncrease / 100);

    let projected = compute + storage + network;
    if (inputs.applyAhb) projected *= AHB_DISCOUNT;

    const baseRounded = round2(baseCost);
    const projectedRounded = round2(projected);
    const delta = round2(projectedRounded - baseRounded);
    const deltaPct = baseRounded > 0 ? Math.round((delta / baseRounded) * 1000) / 10 : 0;

    return {
        baseCost: baseRounded,
        projectedCost: projectedRounded,
        delta,
        deltaPct,
        breakdown: {
            compute: round2(compute * (inputs.applyAhb ? AHB_DISCOUNT : 1)),
            storage: round2(storage * (inputs.applyAhb ? AHB_DISCOUNT : 1)),
            network: round2(network * (inputs.applyAhb ? AHB_DISCOUNT : 1)),
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

    if (!Number.isFinite(computeScale) || computeScale < 0 || computeScale > 10) {
        throw new Error("computeScale fuera de rango (0..10)");
    }
    if (!Number.isFinite(storageScale) || storageScale < 0 || storageScale > 10) {
        throw new Error("storageScale fuera de rango (0..10)");
    }
    if (!Number.isFinite(networkIncrease) || networkIncrease < -100 || networkIncrease > 500) {
        throw new Error("networkIncrease fuera de rango (-100..500)");
    }

    return { computeScale, storageScale, networkIncrease, applyAhb };
}
