import { describe, it, expect } from "vitest";
import { calculateBudgetProjection } from "@/services/budgetService";

describe("calculateBudgetProjection", () => {
    it("should calculate correct projection, burn rate, and OK status when spend is well within budget", () => {
        // Budget: $1000, Spend: $300 on day 15 of a 30-day month
        const proj = calculateBudgetProjection(1000, 300, 15, 30);
        expect(proj.assignedAmount).toBe(1000);
        expect(proj.currentSpend).toBe(300);
        expect(proj.percentageUsed).toBe(30);
        expect(proj.dailyBurnRate).toBe(20);
        expect(proj.forecastedMonthEndSpend).toBe(600);
        expect(proj.forecastedBreachDate).toBeNull();
        expect(proj.budgetStatus).toBe("OK");
    });

    it("should calculate WARNING status when forecasted spend is between 90% and 100%", () => {
        // Budget: $1000, Spend: $460 on day 15 of a 30-day month -> Forecast: $920 (92%)
        const proj = calculateBudgetProjection(1000, 460, 15, 30);
        expect(proj.dailyBurnRate).toBe(30.67);
        expect(proj.forecastedMonthEndSpend).toBe(920);
        expect(proj.forecastedBreachDate).toBeNull();
        expect(proj.budgetStatus).toBe("WARNING");
    });

    it("should calculate CRITICAL status and breach date when forecasted spend exceeds 100%", () => {
        // Budget: $1150, Spend: $693.72 on day 12 of a 30-day month
        // Burn rate: ~57.81/day -> Forecast: ~1734.30
        const proj = calculateBudgetProjection(1150, 693.72, 12, 30);
        expect(proj.budgetStatus).toBe("CRITICAL");
        expect(proj.forecastedBreachDate).toBe("Día 20");
    });

    it("should return 'Excedido' when current spend already exceeded assigned budget", () => {
        const proj = calculateBudgetProjection(1000, 1050, 10, 30);
        expect(proj.budgetStatus).toBe("CRITICAL");
        expect(proj.forecastedBreachDate).toBe("Excedido");
    });

    it("should accurately project when assigned budget is zero or spend is zero", () => {
        const projZero = calculateBudgetProjection(0, 0, 15, 30);
        expect(projZero.percentageUsed).toBe(0);
        expect(projZero.dailyBurnRate).toBe(0);
        expect(projZero.forecastedMonthEndSpend).toBe(0);
        expect(projZero.budgetStatus).toBe("OK");
    });
});

