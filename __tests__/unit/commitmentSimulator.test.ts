import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock de credencial + suscripciones
vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn().mockResolvedValue({}),
    getSubscriptionsForTenant: vi.fn().mockResolvedValue(["sub-1"]),
    // El servicio resuelve el nombre real de la suscripcion con este mapa.
    // Antes lo inventaba: `Sub (${sub.slice(0,8)}...)`, o sea el GUID recortado,
    // y eso era lo que el usuario veia en el filtro del drilldown.
    getSubscriptionNameMap: vi.fn().mockResolvedValue(new Map([["sub-1", "Produccion Norte"]])),
}));

// Mocks de los SDKs de Azure — async iterables controlados por test.
const riItems: any[] = [];
const spItems: any[] = [];
function asyncIter(items: any[]) {
    return { async *[Symbol.asyncIterator]() { for (const i of items) yield i; } };
}
vi.mock("@azure/arm-consumption", () => ({
    ConsumptionManagementClient: class {
        reservationRecommendations = { list: () => asyncIter(riItems) };
    },
}));
vi.mock("@azure/arm-costmanagement", () => ({
    CostManagementClient: class {
        benefitRecommendations = { list: () => asyncIter(spItems) };
    },
}));

import { getCommitmentSimulation } from "@/services/commitmentSimulatorService";

describe("commitmentSimulatorService", () => {
    beforeEach(() => { riItems.length = 0; spItems.length = 0; });

    it("agrega RI por término y elige el mejor SP; calcula veredicto", async () => {
        riItems.push(
            { properties: { term: "P1Y", netSavings: 50 } },
            { properties: { term: "P1Y", netSavings: 30 } },
            { properties: { term: "P3Y", netSavings: 200 } },
        );
        spItems.push(
            { properties: { term: "P1Y", recommendationDetails: { savingsAmount: 60, savingsPercentage: 15, coveragePercentage: 55, commitmentAmount: 0.2 } } },
            { properties: { term: "P1Y", recommendationDetails: { savingsAmount: 100, savingsPercentage: 20, coveragePercentage: 60, commitmentAmount: 0.3 } } },
            { properties: { term: "P3Y", recommendationDetails: { savingsAmount: 150, savingsPercentage: 25, coveragePercentage: 70, commitmentAmount: 0.4 } } },
        );

        const r = await getCommitmentSimulation("t1");

        // RI 1año = 50+30 = 80 (2 recs); 3año = 200 (1 rec)
        expect(r.reservation.oneYear.monthlySavings).toBe(80);
        expect(r.reservation.oneYear.recommendations).toBe(2);
        expect(r.reservation.threeYear.monthlySavings).toBe(200);
        // SP se queda con el mejor por término: 1año=100, 3año=150
        expect(r.savingsPlan.oneYear.monthlySavings).toBe(100);
        expect(r.savingsPlan.threeYear.monthlySavings).toBe(150);
        // Veredicto: 1año SP(100)>RI(80)=savingsPlan; 3año RI(200)>SP(150)=reservation
        expect(r.verdict.oneYear).toBe("savingsPlan");
        expect(r.verdict.threeYear).toBe("reservation");
        expect(r.hasData).toBe(true);

        // Granular items
        expect(r.comparisonData.oneYearComparison.reservationOption.items.length).toBe(2);

        // El payload lleva el DISCRIMINADOR, no la frase. Hasta el 2026-09-08 el
        // servicio mandaba `termDisplayName: "1 año"` y el cliente lo pintaba tal
        // cual: en la UI en ingles salia el termino en castellano. El servidor no
        // conoce el locale del lector, y encima esta respuesta se cachea.
        expect(r.comparisonData.oneYearComparison.term).toBe("1_YEAR");
        expect(r.comparisonData.threeYearComparison.term).toBe("3_YEARS");
        expect(r.comparisonData.oneYearComparison).not.toHaveProperty("termDisplayName");
        expect(r.comparisonData.oneYearComparison).not.toHaveProperty("winnerBadgeText");
        expect(r.comparisonData).not.toHaveProperty("bestPracticeInsightMarkdown");

        // Y el nombre de la suscripcion sale del mapa de Azure, no de recortar el
        // GUID: el filtro del drilldown mostraba `Sub (sub-1...)`.
        const nombres = r.comparisonData.oneYearComparison.reservationOption.items.map((i: any) => i.subscriptionName);
        expect(nombres).toEqual(["Produccion Norte", "Produccion Norte"]);
        expect(nombres.some((n: string) => n.startsWith("Sub ("))).toBe(false);
        expect(r.comparisonData.threeYearComparison.reservationOption.items.length).toBe(1);
        expect(r.comparisonData.threeYearComparison.savingsPlanOption.items.length).toBe(1);
    });

    it("hasData=false y veredicto 'none' cuando no hay recomendaciones", async () => {
        const r = await getCommitmentSimulation("t1");
        expect(r.hasData).toBe(false);
        expect(r.verdict.oneYear).toBe("none");
        expect(r.verdict.threeYear).toBe("none");
        expect(r.reservation.oneYear.monthlySavings).toBe(0);
        expect(r.comparisonData.oneYearComparison.reservationOption.items).toEqual([]);
    });

    it("no explota si una suscripción tira error en un SDK (resiliencia)", async () => {
        // netSavings inválido → Decimal(0); la iteración sigue
        riItems.push({ properties: { term: "P1Y", netSavings: null } });
        const r = await getCommitmentSimulation("t1");
        expect(r.success).toBe(true);
    });
});

