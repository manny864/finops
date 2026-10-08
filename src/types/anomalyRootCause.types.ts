/**
 * Hechos de causa raíz de una anomalía (propuesta de IA, Fase 1a).
 *
 * Módulo puro, sin dependencias de servidor: lo importan el servicio que los
 * calcula, la UI que los muestra, la explicación con IA que los cita y los tests.
 *
 * El grano es servicio + medidor, sumando regiones y resource groups. Es lo que
 * hay en `CostMeterSnapshots`: `CostSnapshots` no tiene ni recurso ni medidor en
 * la ruta de sync por API, y `CostMeterSnapshots` no tiene resource group.
 */

export const ROOT_CAUSE_FACT_TYPES = [
    "NEW_METER",
    "USAGE_INCREASE",
    "PRICE_INCREASE",
    "COST_INCREASE",
    "INSUFFICIENT_DETAIL",
] as const;
export type RootCauseFactType = (typeof ROOT_CAUSE_FACT_TYPES)[number];

export interface RootCauseFact {
    /** "f1", "f2"…: la explicación con IA cita hechos por este id. */
    id: string;
    type: RootCauseFactType;
    serviceName: string;
    /** Sólo en INSUFFICIENT_DETAIL, que es el único hecho a nivel resource group. */
    resourceGroup?: string;
    meterName?: string;
    /** Promedio diario en la ventana base, en USD. */
    baseline: number;
    /** Costo del día de la anomalía, en USD. */
    actual: number;
    delta: number;
    // Los porcentajes vienen calculados para que ni la UI ni el modelo hagan
    // cuentas. Faltan cuando la base es 0 o no hay cantidades.
    costChangePct?: number;
    quantityChangePct?: number;
    unitCostChangePct?: number;
}

export const ROOT_CAUSE_ACTIONS = [
    "REVIEW_NEW_USAGE",
    "CHECK_SCHEDULING",
    "REVIEW_COMMITMENT_COVERAGE",
    "ASSIGN_OWNER",
] as const;
export type RootCauseAction = (typeof ROOT_CAUSE_ACTIONS)[number];

const ACTION_BY_FACT: Partial<Record<RootCauseFactType, RootCauseAction>> = {
    NEW_METER: "REVIEW_NEW_USAGE",
    USAGE_INCREASE: "CHECK_SCHEDULING",
    // Sin CommitmentDiscountId en ninguna ruta de ingesta, un costo unitario que
    // sube es la mejor señal disponible de que se perdió cobertura.
    PRICE_INCREASE: "REVIEW_COMMITMENT_COVERAGE",
};

/**
 * Acciones sugeridas, deterministas. No las elige la IA (principio 1 de la
 * propuesta): un enlace a otra pantalla no puede depender de lo que diga un modelo.
 */
export function suggestedActions(facts: RootCauseFact[] | null | undefined, hasOwner: boolean): RootCauseAction[] {
    const set = new Set<RootCauseAction>();
    for (const f of facts ?? []) {
        const action = ACTION_BY_FACT[f.type];
        if (action) set.add(action);
    }
    if (!hasOwner) set.add("ASSIGN_OWNER");
    return ROOT_CAUSE_ACTIONS.filter((a) => set.has(a));
}
