// @vitest-environment node
/**
 * MEJ-37 — el criterio de orden, que es la mejora entera.
 *
 * La propuesta lo dice explícito: «ordenar por mejora, no por gasto», porque un
 * ranking por gasto absoluto premia al equipo chico y castiga al que corre
 * producción. Estos tests fijan eso y los dos casos que lo romperían.
 */
import { describe, it, expect } from "vitest";
import { armarLeaderboard, UMBRAL_MATERIALIDAD_PCT, type EntradaDeGrupo } from "@/services/leaderboard.service";

const g = (p: Partial<EntradaDeGrupo> & { grupo: string; gasto: number }): EntradaDeGrupo => ({
    gastoPrevio: p.gasto, presupuesto: null, ahorroCapturado: 0, clasificacion: "UNCLASSIFIED", ...p,
});

describe("se ordena por mejora, no por gasto", () => {
    it("el que más bajó va primero, aunque gaste mucho más que el resto", () => {
        const { filas } = armarLeaderboard([
            g({ grupo: "Plataforma", gasto: 90_000, gastoPrevio: 100_000 }), // −10%
            g({ grupo: "Datos", gasto: 9_500, gastoPrevio: 10_000 }),        //  −5%
            g({ grupo: "Web", gasto: 11_000, gastoPrevio: 10_000 }),         // +10%
        ]);
        expect(filas.map((f) => f.grupo)).toEqual(["Plataforma", "Datos", "Web"]);
        expect(filas[0].puesto).toBe(1);
    });

    it("el equipo chico NO gana sólo por ser chico", () => {
        // Con orden por gasto absoluto, Chico sería primero siempre.
        const { filas } = armarLeaderboard([
            g({ grupo: "Chico", gasto: 5_000, gastoPrevio: 5_000 }),           //  0%
            g({ grupo: "Produccion", gasto: 80_000, gastoPrevio: 100_000 }),   // −20%
        ]);
        expect(filas[0].grupo).toBe("Produccion");
    });

    it("a igual variación, desempata el ahorro capturado", () => {
        const { filas } = armarLeaderboard([
            g({ grupo: "A", gasto: 9_000, gastoPrevio: 10_000, ahorroCapturado: 100 }),
            g({ grupo: "B", gasto: 9_000, gastoPrevio: 10_000, ahorroCapturado: 900 }),
        ]);
        expect(filas.map((f) => f.grupo)).toEqual(["B", "A"]);
    });

    it("el criterio viaja en la respuesta, para poder escribirlo en pantalla", () => {
        const { criterio } = armarLeaderboard([g({ grupo: "A", gasto: 10 })]);
        expect(criterio.ordenadoPor).toBe("mejora");
        expect(criterio.descripcion).toMatch(/gasto absoluto premia al equipo chico/);
        expect(criterio.umbralMaterialidadPct).toBe(UMBRAL_MATERIALIDAD_PCT);
    });
});

describe("los dos casos que romperían el ranking", () => {
    it("un grupo sin período anterior se lista, pero NO se rankea", () => {
        // Ni primero ni último: no hay contra qué compararlo. Ponerlo primero
        // lo premiaría por haber nacido.
        const { filas } = armarLeaderboard([
            g({ grupo: "Viejo", gasto: 9_000, gastoPrevio: 10_000 }),
            g({ grupo: "Nuevo", gasto: 50_000, gastoPrevio: null }),
        ]);
        const nuevo = filas.find((f) => f.grupo === "Nuevo")!;
        expect(nuevo.puesto).toBeNull();
        expect(nuevo.sinRanking).toBe("sin-periodo-previo");
        expect(nuevo.variacionPct).toBeNull();
        // Y aparece: no se lo excluye de la tabla.
        expect(filas.map((f) => f.grupo)).toContain("Nuevo");
    });

    it("el ruido de un grupo diminuto no le gana al que recortó de verdad", () => {
        // 1 → 0,50 es −50%. Sin umbral, le ganaría a −10% sobre 100.000.
        const { filas } = armarLeaderboard([
            g({ grupo: "Ruido", gasto: 0.5, gastoPrevio: 1 }),
            g({ grupo: "Produccion", gasto: 90_000, gastoPrevio: 100_000 }),
        ]);
        expect(filas[0].grupo).toBe("Produccion");
        expect(filas.find((f) => f.grupo === "Ruido")!.sinRanking).toBe("no-material");
    });

    it("pero un grupo chico que SÍ es material se rankea normal", () => {
        const { filas } = armarLeaderboard([
            g({ grupo: "Chico", gasto: 4_000, gastoPrevio: 8_000 }),      // 4% del total
            g({ grupo: "Grande", gasto: 90_000, gastoPrevio: 100_000 }),
        ]);
        expect(filas[0].grupo).toBe("Chico");
        expect(filas[0].sinRanking).toBeNull();
    });
});

describe("el presupuesto", () => {
    it("un grupo sin presupuesto aparece con la columna vacía, no excluido", () => {
        const { filas } = armarLeaderboard([
            g({ grupo: "Con", gasto: 5_000, presupuesto: 10_000 }),
            g({ grupo: "Sin", gasto: 5_000, presupuesto: null }),
        ]);
        expect(filas).toHaveLength(2);
        expect(filas.find((f) => f.grupo === "Con")!.adherenciaPct).toBe(50);
        expect(filas.find((f) => f.grupo === "Sin")!.adherenciaPct).toBeNull();
    });

    it("un presupuesto en cero no divide por cero: se informa como sin dato", () => {
        const { filas } = armarLeaderboard([g({ grupo: "A", gasto: 100, presupuesto: 0 })]);
        expect(filas[0].adherenciaPct).toBeNull();
    });
});

describe("el split COGS/OpEx", () => {
    it("suma exactamente el total, con UNCLASSIFIED a la vista", () => {
        // Criterio 3: sin esto no se puede calcular margen bruto — el pedazo
        // que falta se leería como cero.
        const { split } = armarLeaderboard([
            g({ grupo: "Prod", gasto: 60_000, clasificacion: "COGS" }),
            g({ grupo: "Corp", gasto: 30_000, clasificacion: "OPEX" }),
            g({ grupo: "Otro", gasto: 10_000, clasificacion: "UNCLASSIFIED" }),
        ]);
        expect(split).toEqual({ COGS: 60_000, OPEX: 30_000, UNCLASSIFIED: 10_000, total: 100_000 });
        expect(split.COGS + split.OPEX + split.UNCLASSIFIED).toBe(split.total);
    });
});

describe("MEJ-37 fase 2 — el margen bruto", () => {
    it("sin ingresos devuelve null, NO 0%", async () => {
        // 0% sería afirmar que todo lo que entra se va en nube. Lo que pasa es
        // que nadie ingestó el dato, que es otra cosa.
        const { margenBruto } = await import("@/services/leaderboard.service");
        const m = margenBruto(null, { COGS: 60_000, UNCLASSIFIED: 0 });
        expect(m.margenPct).toBeNull();
        expect(m.margenPeorCasoPct).toBeNull();
    });

    it("con ingresos en cero tampoco divide", async () => {
        const { margenBruto } = await import("@/services/leaderboard.service");
        expect(margenBruto(0, { COGS: 100, UNCLASSIFIED: 0 }).margenPct).toBeNull();
    });

    it("el cálculo es (ingresos − COGS) / ingresos", async () => {
        const { margenBruto } = await import("@/services/leaderboard.service");
        expect(margenBruto(200_000, { COGS: 60_000, UNCLASSIFIED: 0 }).margenPct).toBe(70);
    });

    it("un margen NEGATIVO no se recorta a cero", async () => {
        // Gastar más de lo que entra es un hecho, y es el hecho que esta
        // pantalla existe para mostrar.
        const { margenBruto } = await import("@/services/leaderboard.service");
        expect(margenBruto(50_000, { COGS: 80_000, UNCLASSIFIED: 0 }).margenPct).toBe(-60);
    });

    it("lo sin clasificar da un RANGO, porque empuja el margen hacia arriba", async () => {
        // Sin el peor caso, el número se lee mejor de lo que es — y un margen
        // optimista es el error que un número financiero no puede cometer.
        const { margenBruto } = await import("@/services/leaderboard.service");
        const m = margenBruto(200_000, { COGS: 60_000, UNCLASSIFIED: 40_000 });
        expect(m.margenPct).toBe(70);
        expect(m.margenPeorCasoPct).toBe(50);
        expect(m.esRango).toBe(true);
    });

    it("sin gasto sin clasificar no hay rango que mostrar", async () => {
        const { margenBruto } = await import("@/services/leaderboard.service");
        const m = margenBruto(200_000, { COGS: 60_000, UNCLASSIFIED: 0 });
        expect(m.esRango).toBe(false);
        expect(m.margenPeorCasoPct).toBe(m.margenPct);
    });
});

describe("REVENUE es dinero, no volumen", () => {
    it("se puede ingestar", async () => {
        const { isValidMetricType } = await import("@/services/azureUnitEconomics.service");
        expect(isValidMetricType("REVENUE")).toBe(true);
    });

    it("pero NO sirve como denominador de un costo unitario", async () => {
        // "costo por unidad de REVENUE" da uno menos el margen: un número
        // correcto con el rótulo equivocado.
        const { ES_VOLUMEN } = await import("@/types/azureUnitEconomics.types");
        expect(ES_VOLUMEN.REVENUE).toBe(false);
        expect(ES_VOLUMEN.TRANSACTIONS).toBe(true);
    });

    it("y no se escala como los volúmenes grandes", async () => {
        const { UNIT_METRIC_CATALOG } = await import("@/types/azureUnitEconomics.types");
        expect(UNIT_METRIC_CATALOG.REVENUE.scale).toBe(1);
        expect(UNIT_METRIC_CATALOG.API_CALLS.scale).toBe(1_000_000);
    });
});
