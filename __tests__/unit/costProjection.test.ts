import { describe, it, expect } from "vitest";
import { projectFutureCosts, buildDailyHistogram, aggregateHistogramByGranularity } from "@/lib/costProjection";

describe("costProjection", () => {
    describe("projectFutureCosts — continuity anchor (Projection Stitching)", () => {
        it("anchors the first projected month to the last real month, not the 12m average", () => {
            // Historial creciente: promedio bajo, último mes real alto — el bug
            // original arrancaba la proyección desde el promedio (mucho más bajo
            // que el último real), generando un salto visual en el empalme.
            const monthlyHistory = [
                { month: "2026-01", cost: 20 },
                { month: "2026-02", cost: 25 },
                { month: "2026-03", cost: 30 },
                { month: "2026-04", cost: 50 }, // último mes real
            ];
            const result = projectFutureCosts(monthlyHistory, 0, 3);
            // Con 0% de crecimiento anual, el primer mes proyectado debe quedar
            // prácticamente igual al último real ($50), no al promedio (~$31.25).
            expect(result.projection[0].projectedCost).toBeCloseTo(50, 0);
            expect(result.projection[0].projectedCost).not.toBeCloseTo(result.baseMonthlyAverage, 0);
        });

        it("compounds growth from the last real value forward", () => {
            const monthlyHistory = [
                { month: "2026-01", cost: 100 },
                { month: "2026-02", cost: 100 },
            ];
            const result = projectFutureCosts(monthlyHistory, 12, 2); // 12% anual
            // month 1 > último real, month 2 > month 1 (crecimiento compuesto).
            expect(result.projection[0].projectedCost).toBeGreaterThan(100);
            expect(result.projection[1].projectedCost).toBeGreaterThan(result.projection[0].projectedCost);
        });
    });

    describe("projectFutureCosts — confidence bands", () => {
        it("returns upperBound >= projectedCost >= lowerBound >= 0 for every month", () => {
            const monthlyHistory = [
                { month: "2026-01", cost: 80 },
                { month: "2026-02", cost: 120 },
                { month: "2026-03", cost: 60 },
                { month: "2026-04", cost: 140 },
            ];
            const result = projectFutureCosts(monthlyHistory, 10, 6);
            for (const p of result.projection) {
                expect(p.upperBound).toBeGreaterThanOrEqual(p.projectedCost);
                expect(p.projectedCost).toBeGreaterThanOrEqual(p.lowerBound);
                expect(p.lowerBound).toBeGreaterThanOrEqual(0);
            }
        });

        it("widens the band further out in the horizon (random-walk growth)", () => {
            const monthlyHistory = [
                { month: "2026-01", cost: 100 },
                { month: "2026-02", cost: 110 },
                { month: "2026-03", cost: 90 },
            ];
            const result = projectFutureCosts(monthlyHistory, 5, 6);
            const firstSpread = result.projection[0].upperBound - result.projection[0].lowerBound;
            const lastSpread = result.projection[5].upperBound - result.projection[5].lowerBound;
            expect(lastSpread).toBeGreaterThan(firstSpread);
        });
    });

    describe("buildDailyHistogram", () => {
        it("fills missing calendar days with $0 for strict continuity", () => {
            const daily = [
                { date: "2026-08-01", cost: 10 },
                { date: "2026-08-04", cost: 5 }, // huecos: 08-02, 08-03
            ];
            const points = buildDailyHistogram(daily);
            expect(points.map((p) => p.date)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"]);
            expect(points[1].cost).toBe(0);
            expect(points[2].cost).toBe(0);
        });

        it("flags Saturdays and Sundays as isWeekend", () => {
            // 2026-08-01 es sábado (UTC).
            const points = buildDailyHistogram([{ date: "2026-08-01", cost: 10 }, { date: "2026-08-02", cost: 10 }, { date: "2026-08-03", cost: 10 }]);
            expect(points[0].isWeekend).toBe(true); // sábado
            expect(points[1].isWeekend).toBe(true); // domingo
            expect(points[2].isWeekend).toBe(false); // lunes
        });

        it("flags a day as isSpike when cost exceeds 2x the trailing 7d moving average", () => {
            const daily = [
                { date: "2026-08-01", cost: 1 },
                { date: "2026-08-02", cost: 1 },
                { date: "2026-08-03", cost: 1 },
                { date: "2026-08-04", cost: 20 }, // pico
            ];
            const points = buildDailyHistogram(daily);
            expect(points[3].isSpike).toBe(true);
            expect(points[0].isSpike).toBe(false);
        });

        it("attaches the dominant service only on spike days when provided", () => {
            const daily = [
                { date: "2026-08-01", cost: 1 },
                { date: "2026-08-02", cost: 1 },
                { date: "2026-08-03", cost: 20 },
            ];
            const serviceTopByDate = new Map([["2026-08-03", "Azure Cache for Redis"]]);
            const points = buildDailyHistogram(daily, serviceTopByDate);
            expect(points[2].spikeService).toBe("Azure Cache for Redis");
            expect(points[0].spikeService).toBeFalsy();
        });
    });

    describe("aggregateHistogramByGranularity", () => {
        const points = buildDailyHistogram([
            { date: "2026-08-01", cost: 10 },
            { date: "2026-08-02", cost: 10 },
            { date: "2026-08-03", cost: 10 },
            { date: "2026-09-01", cost: 5 },
        ]);

        it("returns the same points untouched for 'daily'", () => {
            const result = aggregateHistogramByGranularity(points, "daily");
            expect(result).toHaveLength(points.length);
        });

        it("sums cost per calendar month for 'monthly'", () => {
            const result = aggregateHistogramByGranularity(points, "monthly");
            const august = result.find((r) => r.date === "2026-08");
            expect(august?.cost).toBe(30);
        });
    });
});
