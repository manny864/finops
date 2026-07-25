import { describe, it, expect } from "vitest";
import { runScenario, parseInputs } from "@/lib/simulator/engine";

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

        it("en AWS no asume ahorro de licencias sin un porcentaje explicito", () => {
            // BYOL en AWS exige Dedicated Hosts y depende del mix Windows/SQL:
            // no hay un valor plano defendible, asi que el default es 0 y el
            // supuesto lo declara el usuario.
            const r = runScenario(1000, { applyAhb: true }, "aws");
            expect(r.projectedCost).toBe(1000);
            expect(r.deltaPct).toBe(0);

            const declarado = runScenario(1000, { applyAhb: true, licenseSavingsPct: 25 }, "aws");
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
