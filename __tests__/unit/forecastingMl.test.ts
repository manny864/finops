import { describe, it, expect } from "vitest";
import {
    dampedHoltForecast,
    ensembleForecast,
    selectBestMethodExtended,
    type HistoryPoint,
} from "@/lib/forecasting";

function series(values: number[], startDate = "2026-06-01"): HistoryPoint[] {
    const out: HistoryPoint[] = [];
    const d = new Date(startDate);
    for (let i = 0; i < values.length; i++) {
        const date = new Date(d);
        date.setDate(d.getDate() + i);
        out.push({ date: date.toISOString().slice(0, 10), value: values[i].toFixed(2) });
    }
    return out;
}

describe("forecasting — damped Holt", () => {
    it("rejects too-short history", () => {
        expect(() => dampedHoltForecast(series([100]), 5)).toThrow();
    });

    it("rejects phi outside (0, 1]", () => {
        expect(() => dampedHoltForecast(series([100, 110, 120]), 5, 0.3, 0.1, 0)).toThrow();
        expect(() => dampedHoltForecast(series([100, 110, 120]), 5, 0.3, 0.1, 1.5)).toThrow();
    });

    it("produces non-negative forecast values", () => {
        const fc = dampedHoltForecast(series([100, 120, 140, 160, 180]), 10);
        for (const p of fc) expect(parseFloat(p.value)).toBeGreaterThanOrEqual(0);
    });

    it("forecast dampens vs linear extrapolation on growing series", () => {
        const hist = series([100, 120, 140, 160, 180, 200, 220, 240, 260, 280]);
        const fcDamped = dampedHoltForecast(hist, 30);
        const last = 280;
        // Pure linear at +20/day for 30 days would land at 880. Damped should be lower.
        const dampedDay30 = parseFloat(fcDamped[fcDamped.length - 1].value);
        expect(dampedDay30).toBeLessThan(last + 30 * 20);
        expect(dampedDay30).toBeGreaterThan(last);
    });

    it("tags points with method='damped_holt'", () => {
        const fc = dampedHoltForecast(series([100, 110, 120, 130]), 3);
        for (const p of fc) expect(p.method).toBe("damped_holt");
    });

    it("emits the requested number of days", () => {
        const fc = dampedHoltForecast(series([100, 110, 120, 130]), 7);
        expect(fc.length).toBe(7);
    });
});

describe("forecasting — ensemble", () => {
    it("rejects too-short history", () => {
        expect(() => ensembleForecast(series([100]), 5)).toThrow();
    });

    it("emits requested days and labels each as 'ensemble'", () => {
        const fc = ensembleForecast(series([100, 105, 110, 115, 120, 125]), 5);
        expect(fc.length).toBe(5);
        for (const p of fc) expect(p.method).toBe("ensemble");
    });

    it("produces non-negative values", () => {
        const fc = ensembleForecast(series([100, 90, 95, 100, 110]), 10);
        for (const p of fc) expect(parseFloat(p.value)).toBeGreaterThanOrEqual(0);
    });

    it("on a near-flat series, ensemble stays in the same band", () => {
        const fc = ensembleForecast(series([100, 102, 99, 101, 100, 103, 98, 101]), 5);
        for (const p of fc) {
            const v = parseFloat(p.value);
            expect(v).toBeGreaterThan(50);
            expect(v).toBeLessThan(200);
        }
    });
});

describe("forecasting — selectBestMethodExtended", () => {
    it("falls back to linear on very short history", () => {
        expect(selectBestMethodExtended(series([100, 110]))).toBe("linear");
        expect(selectBestMethodExtended(series([100, 110, 120, 130]))).toBe("linear");
    });

    it("returns one of the supported methods on a real series", () => {
        const m = selectBestMethodExtended(series([100, 110, 120, 130, 140, 150, 160, 170]));
        expect(["linear", "ema", "holt_winters", "damped_holt", "ensemble"]).toContain(m);
    });

    it("never throws on a noisy series", () => {
        const noisy = series([100, 95, 110, 88, 120, 92, 130, 99, 140, 105, 150, 110, 160, 115]);
        expect(() => selectBestMethodExtended(noisy)).not.toThrow();
    });
});
