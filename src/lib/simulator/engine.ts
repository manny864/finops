/**
 * Pure simulator math. Extracted from /api/intelligence/simulator/route.ts so
 * the same projection can run on save and compare endpoints without duplicating
 * coefficients, and so it is unit-testable in isolation.
 *
 * Mix assumptions (baseline shared by both providers):
 *   compute = 60% · baseCost · computeScale
 *   storage = 25% · baseCost · storageScale
 *   network = 15% · baseCost · (1 + networkIncrease/100)
 *
 * Licencias (AHB en Azure, BYOL en AWS): el descuento se aplica SOLO al
 * componente de cómputo. Antes se aplicaba al total, lo que sobreestimaba el
 * ahorro: ni el Azure Hybrid Benefit ni el BYOL de AWS abaratan un byte de
 * storage ni un GB de egress — cubren licencias de Windows Server / SQL Server,
 * que se pagan con el cómputo.
 *
 * El porcentaje es un INPUT, no una constante escondida. Azure trae 18% por
 * defecto (valor histórico de AHB con el que se calibró esta herramienta); AWS
 * trae 0 a propósito: el BYOL de AWS exige Dedicated Hosts y su ahorro depende
 * del mix Windows/SQL de la flota, así que el usuario declara su supuesto en
 * vez de comerse un número inventado.
 */

import { toMoneyNumber } from "@/lib/money";

export interface SimulatorInputs {
    /** Compute scale factor — 1 = 100%, 1.5 = +50%. */
    computeScale?: number;
    /** Storage scale factor — 1 = 100%. */
    storageScale?: number;
    /** Network egress increase in percent points (−50..+200). */
    networkIncrease?: number;
    /** Apply license benefit (Azure Hybrid Benefit / AWS BYOL). */
    applyAhb?: boolean;
    /**
     * Ahorro por licencias, en puntos porcentuales sobre el cómputo (0..100).
     * Si se omite se usa el default del proveedor.
     */
    licenseSavingsPct?: number;
}

/** Proveedores para los que el simulador tiene defaults calibrados. */
export type SimulatorProvider = "azure";

/** Default de ahorro por licencias, en % sobre el cómputo (18 = valor histórico de AHB). */
export const DEFAULT_LICENSE_SAVINGS_PCT: Record<SimulatorProvider, number> = {
    azure: 18,
};

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

    const compute = baseCost * COMPUTE_SHARE * computeScale * licenseFactor;
    const storage = baseCost * STORAGE_SHARE * storageScale;
    const network = baseCost * NETWORK_SHARE * (1 + networkIncrease / 100);

    const projected = compute + storage + network;

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
            compute: round2(compute),
            storage: round2(storage),
            network: round2(network),
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

    return { computeScale, storageScale, networkIncrease, applyAhb, licenseSavingsPct };
}
