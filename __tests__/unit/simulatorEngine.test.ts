import { describe, it, expect } from "vitest";
import { runScenario, parseInputs, type SimulatorProvider } from "@/lib/simulator/engine";

describe("simulator engine", () => {
    describe("runScenario", () => {
        it("computes baseline (no change) with mix 60/25/15", () => {
            const r = runScenario(1000, { computeScale: 1, storageScale: 1, networkIncrease: 0, applyAhb: false });
            expect(r.baseCost).toBe(1000);
            expect(r.projectedCost).toBe(1000);
            expect(r.delta).toBe(0);
            expect(r.deltaPct).toBe(0);
            expect(r.breakdown.compute).toBe(600);
            expect(r.breakdown.storage).toBe(250);
            expect(r.breakdown.network).toBe(150);
        });

        it("scales compute and storage independently", () => {
            const r = runScenario(1000, { computeScale: 2, storageScale: 1, networkIncrease: 0, applyAhb: false });
            // compute: 600 * 2 = 1200, storage: 250, network: 150 → 1600
            expect(r.projectedCost).toBe(1600);
            expect(r.deltaPct).toBe(60);
            expect(r.breakdown.compute).toBe(1200);
        });

        it("applies network egress increase", () => {
            const r = runScenario(1000, { networkIncrease: 100 });
            // network: 150 * 2 = 300 → 600+250+300 = 1150
            expect(r.projectedCost).toBe(1150);
            expect(r.breakdown.network).toBe(300);
        });

        it("aplica el descuento de licencias solo al computo", () => {
            // AHB cubre licencias de Windows/SQL, que se pagan junto con la
            // VM. No abarata ni el storage ni el egress: aplicarlo al total
            // (como se hacia antes) sobreestimaba el ahorro.
            const r = runScenario(1000, { applyAhb: true });
            // compute 600*0.82 = 492; storage y network intactos
            expect(r.projectedCost).toBe(892);
            expect(r.deltaPct).toBeCloseTo(-10.8, 5);
            expect(r.breakdown.compute).toBeCloseTo(492, 0);
            expect(r.breakdown.storage).toBe(250);
            expect(r.breakdown.network).toBe(150);
        });

        it("respeta el porcentaje de licencias declarado por el usuario", () => {
            const r = runScenario(1000, { applyAhb: true, licenseSavingsPct: 40 });
            // compute 600*0.60 = 360 → 360+250+150 = 760
            expect(r.projectedCost).toBe(760);
            expect(r.breakdown.compute).toBeCloseTo(360, 0);
        });

        it("un proveedor sin default calibrado no asume ahorro de licencias", () => {
            // El default de 18% es el valor historico de AHB, especifico de
            // Azure. Un proveedor sin coeficiente propio cae a 0 en vez de
            // heredarlo: el supuesto lo declara el usuario.
            const desconocido = "otro" as unknown as SimulatorProvider;
            const r = runScenario(1000, { applyAhb: true }, desconocido);
            expect(r.projectedCost).toBe(1000);
            expect(r.deltaPct).toBe(0);

            const declarado = runScenario(1000, { applyAhb: true, licenseSavingsPct: 25 }, desconocido);
            expect(declarado.breakdown.compute).toBeCloseTo(450, 0);
        });

        it("rejects non-positive baseCost", () => {
            expect(() => runScenario(0, {})).toThrow();
            expect(() => runScenario(-100, {})).toThrow();
        });

        it("handles network decrease (-50%)", () => {
            const r = runScenario(1000, { networkIncrease: -50 });
            // network: 150 * 0.5 = 75 → 925
            expect(r.projectedCost).toBe(925);
            expect(r.breakdown.network).toBe(75);
        });

        it("breakdown sums match projectedCost (rounding tolerant)", () => {
            const r = runScenario(12345.67, { computeScale: 1.3, storageScale: 1.5, networkIncrease: 25, applyAhb: true });
            const sum = r.breakdown.compute + r.breakdown.storage + r.breakdown.network;
            expect(Math.abs(sum - r.projectedCost)).toBeLessThanOrEqual(0.05);
        });

        it("applies Savings Plan coverage discount (35%) to the covered compute share", () => {
            const r = runScenario(1000, { savingsPlanCoveragePercent: 100 });
            // compute 600 * (1 - 0.35) = 390 → 390+250+150 = 790
            expect(r.breakdown.compute).toBeCloseTo(390, 0);
            expect(r.projectedCost).toBeCloseTo(790, 0);
        });

        it("applies Spot instances discount (70%) to the spot compute share", () => {
            const r = runScenario(1000, { spotInstancesPercent: 50 });
            // discount factor = 1 - 0.5*0.70 = 0.65 → compute 600*0.65 = 390
            expect(r.breakdown.compute).toBeCloseTo(390, 0);
        });

        it("clamps combined Savings Plan + Spot discount so compute never goes negative", () => {
            const r = runScenario(1000, { savingsPlanCoveragePercent: 100, spotInstancesPercent: 100 });
            expect(r.breakdown.compute).toBeGreaterThanOrEqual(0);
        });

        it("savingsBreakdown isolates AHB savings from compute scale/commitment delta", () => {
            const r = runScenario(1000, { applyAhb: true, licenseSavingsPct: 18 });
            expect(r.savingsBreakdown.computeDelta).toBe(0); // no scale/commitment change vs baseline
            expect(r.savingsBreakdown.ahbSavings).toBeLessThan(0); // AHB always saves
            expect(r.savingsBreakdown.storageDelta).toBe(0);
            expect(r.savingsBreakdown.networkDelta).toBe(0);
            expect(r.savingsBreakdown.totalNetDelta).toBe(r.delta);
            expect(r.savingsBreakdown.percentageChange).toBe(r.deltaPct);
        });
    });

    describe("parseInputs", () => {
        it("defaults missing fields", () => {
            const i = parseInputs({});
            expect(i.computeScale).toBe(1);
            expect(i.storageScale).toBe(1);
            expect(i.networkIncrease).toBe(0);
            expect(i.applyAhb).toBe(false);
        });

        it("coerces strings to numbers", () => {
            const i = parseInputs({ computeScale: "1.5", networkIncrease: "10" });
            expect(i.computeScale).toBe(1.5);
            expect(i.networkIncrease).toBe(10);
        });

        it("rejects out-of-range computeScale", () => {
            expect(() => parseInputs({ computeScale: -1 })).toThrow();
            expect(() => parseInputs({ computeScale: 100 })).toThrow();
        });

        it("rejects out-of-range networkIncrease", () => {
            expect(() => parseInputs({ networkIncrease: -200 })).toThrow();
            expect(() => parseInputs({ networkIncrease: 9999 })).toThrow();
        });

        it("rejects non-object input", () => {
            expect(() => parseInputs(null)).toThrow();
            expect(() => parseInputs("hi")).toThrow();
        });
    });
});
