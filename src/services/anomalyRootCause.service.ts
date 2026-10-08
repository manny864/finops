import type { AnomalyContributor } from "@/services/anomalyDetectionService";
import type { RootCauseFact } from "@/types/anomalyRootCause.types";

/**
 * Clasificación de causa raíz, pura: no toca la base. La usan el loader de
 * anomalyDetectionService y la demo (mockData), igual que MEJ-34/MEJ-40.
 */

export const MAX_CONTRIBUTORS = 3;
const MAX_METERS_PER_SERVICE = 3;

/** Una fila agregada de `CostMeterSnapshots`: el día D y la suma de la ventana base. */
export interface MeterRow {
    service_name: string;
    meter_name: string;
    day_cost: number | string;
    day_qty: number | string;
    base_cost: number | string;
    base_qty: number | string;
}

type Draft = Omit<RootCauseFact, "id">;

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (now: number, before: number) =>
    before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : undefined;

function classify(r: MeterRow, days: number): Draft | null {
    const actual = Number(r.day_cost) || 0;
    const baseline = (Number(r.base_cost) || 0) / days;
    const delta = actual - baseline;
    if (delta < 0.005) return null;

    const fact: Draft = {
        type: baseline === 0 ? "NEW_METER" : "COST_INCREASE",
        serviceName: r.service_name,
        meterName: r.meter_name || undefined,
        baseline: r2(baseline),
        actual: r2(actual),
        delta: r2(delta),
        costChangePct: pct(actual, baseline),
    };
    const q1 = Number(r.day_qty) || 0;
    const q0 = (Number(r.base_qty) || 0) / days;
    if (baseline > 0 && q0 > 0 && q1 > 0) {
        const u0 = baseline / q0;
        const u1 = actual / q1;
        // Descomposición precio-volumen: delta = (q1-q0)·u0 + q1·(u1-u0).
        // Gana el efecto que más explica el delta.
        fact.type = q1 * (u1 - u0) > (q1 - q0) * u0 ? "PRICE_INCREASE" : "USAGE_INCREASE";
        fact.quantityChangePct = pct(q1, q0);
        fact.unitCostChangePct = pct(u1, u0);
    }
    return fact;
}

/**
 * Hechos de causa raíz a partir de los contribuyentes y del detalle por medidor.
 * Pura: el test la ejercita con fixtures.
 *
 * `baselineDays` son los días CON DATOS en la ventana base: un medidor que corrió
 * un día de treinta promedia 1/30, no su costo de ese día. Sin días de base no
 * hay contra qué comparar, y todo medidor parecería nuevo: se declara
 * INSUFFICIENT_DETAIL en vez de adivinar.
 */
export function buildRootCauseFacts(contributors: AnomalyContributor[], rows: MeterRow[], baselineDays: number): RootCauseFact[] {
    const byService = new Map<string, Draft[]>();
    if (baselineDays > 0) {
        for (const r of rows) {
            const fact = classify(r, baselineDays);
            if (fact) byService.set(r.service_name, [...(byService.get(r.service_name) ?? []), fact]);
        }
    }

    const out: Draft[] = [];
    const emitted = new Set<string>();
    for (const c of contributors.slice(0, MAX_CONTRIBUTORS)) {
        const meters = byService.get(c.service_name);
        if (!meters?.length) {
            out.push({
                type: "INSUFFICIENT_DETAIL",
                serviceName: c.service_name,
                resourceGroup: c.resource_group,
                baseline: c.baseline_avg,
                actual: c.cost,
                delta: c.delta,
                costChangePct: pct(c.cost, c.baseline_avg),
            });
        } else if (!emitted.has(c.service_name)) {
            // El detalle por medidor es por servicio: dos resource groups del
            // mismo servicio comparten los mismos medidores.
            emitted.add(c.service_name);
            out.push(...meters.sort((a, b) => b.delta - a.delta).slice(0, MAX_METERS_PER_SERVICE));
        }
    }
    return out.map((f, i) => ({ id: `f${i + 1}`, ...f }));
}
