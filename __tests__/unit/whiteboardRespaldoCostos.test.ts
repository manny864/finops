// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "..", "..");
const sin = (p: string) =>
    readFileSync(join(RAIZ, p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Dos caminos de la misma app calculaban "el costo del mes" con filtros de
 * fecha distintos. Con Cost Management throttleado --que es cuando el respaldo
 * importa-- el Resumen Ejecutivo mostraba $0.00 mientras el dashboard leía
 * 243.25 de la MISMA tabla. Que difieran es peor que que falten: el usuario ve
 * dos números y ninguno explica al otro.
 */
describe("el respaldo de costos del whiteboard filtra igual que el dashboard", () => {
    const whiteboard = sin("src/app/api/intelligence/whiteboard/route.ts");

    it("el respaldo prioriza `date`, no el inicio del período de cargo", () => {
        // `COALESCE(ChargePeriodStart, date)` dejaba afuera las filas cuyo
        // período de facturación arranca antes del mes en curso.
        expect(whiteboard).toContain("COALESCE(date, ChargePeriodStart)");
        expect(whiteboard).not.toContain("COALESCE(ChargePeriodStart, date)) >= DATE_FORMAT");
    });

    // El pronóstico vivía DENTRO de `getCostFigures`, o sea bajo el techo de esa
    // fuente: se comía los 25 s, la degradaba entera y se perdía el costo del
    // mes, que ya estaba calculado. La pantalla mostraba $0.00 con la base
    // llena. Ahora es fuente propia -- lo cubre `whiteboardForecastFuente`.
    it("si costFigures degrada, el respaldo conserva el costo del mes", () => {
        // `currentMonth` ya trae su propio fallback a CostSnapshots y se calcula
        // ANTES del Promise.all: devolver ceros acá tiraba un dato que ya estaba
        // en memoria.
        expect(whiteboard).toMatch(/costMtdUSD: Number\(currentMonth\.totalUSD/);
        expect(whiteboard).not.toMatch(/fuente\("costFigures", \{\s*costMtdUSD: 0/);
    });

    it("el ensamblado loguea el monto, no sólo el tiempo", () => {
        // Sin el valor en el log, un $0.00 en pantalla no distingue "Cost
        // Management falló" de "el respaldo filtró mal".
        expect(whiteboard).toMatch(/costMtd=\$\{/);
    });

    it("el respaldo suma la misma columna que el dashboard", () => {
        // El dashboard hace COALESCE(EffectiveCost, BilledCost, cost_usd) y acá
        // faltaba BilledCost: misma tabla, dos totales posibles.
        expect(whiteboard).toContain("COALESCE(EffectiveCost, BilledCost, cost_usd, 0)");
    });
});

/**
 * El costo del mes se resuelve ANTES del `Promise.all` --alimenta a
 * `getCostFigures`--, así que era la única fuente de costo que quedó fuera de
 * `fuente()` y sin techo. Medido en prod el 2026-09-15 sobre el mismo tenant,
 * el ensamblado tardaba 104, 162, 201 y 261 s mientras las doce fuentes con
 * techo respondían entre 12 y 440 ms. Cloudflare corta a los 100 s: el usuario
 * no veía un costo degradado, veía un 524.
 */
describe("la consulta en vivo del costo del mes tiene techo", () => {
    const whiteboard = sin("src/app/api/intelligence/whiteboard/route.ts");
    const agregacion = whiteboard.slice(
        whiteboard.indexOf("async function getCurrentMonthCostAggregation"),
        whiteboard.indexOf("function proyeccionLineal"),
    );

    it("la llamada a Cost Management pasa por `fuente`", () => {
        expect(agregacion).toMatch(/fuente\(\s*"costMtdLive"/);
    });

    it("el techo envuelve la consulta en vivo y no a toda la función", () => {
        // Con el techo por fuera, al vencer devolvería la agregación vacía y la
        // tarjeta mostraría $0 sin llegar a mirar CostSnapshots -- que es
        // justamente lo que el respaldo existe para evitar.
        expect(agregacion).toContain("FROM CostSnapshots");
        expect(agregacion.indexOf("costMtdLive")).toBeLessThan(agregacion.indexOf("FROM CostSnapshots"));
    });

    it("un costo degradado no se cachea con el TTL largo", () => {
        // `alDegradar` marca `costDegraded`, que el dynamicTtl usa para cachear
        // 1 h en vez de 12 h. Sin esto, un timeout congelaba el número malo.
        expect(whiteboard).toMatch(/getCurrentMonthCostAggregation\(tenantId, \(\) => \{\s*costDegraded = true;/);
    });

    it("el log dice de dónde salió el número", () => {
        // Un `costMtd=0` puede ser "Azure no contestó", "la tabla no tiene el
        // mes" o "gastaste cero", y los tres se veían igual.
        expect(agregacion).toMatch(/costMtd origen=\$\{origen\}/);
    });
});

describe("el botón Actualizar atraviesa el caché del servidor", () => {
    const board = sin("src/components/dashboard/ExecutiveSummaryBoard.tsx");

    // Hacía `mutate()` a secas: SWR repetía la MISMA URL y el servidor devolvía
    // lo cacheado (12 h, o 1 h si el costo vino degradado). Con un número malo
    // en pantalla, el botón no podía cambiarlo -- parecía roto.
    it("el click manda bust=1", () => {
        expect(board).toMatch(/bust=1/);
        expect(board).not.toMatch(/onClick=\{\(\) => mutate\(\)\}/);
    });

    // El bust sólo va en el click: si fuera siempre, cada apertura pagaría el
    // ensamblado completo contra Azure.
    it("la carga normal no bustea", () => {
        const useSwrPrincipal = board.slice(board.indexOf("const { data, error, isLoading, mutate } = useSWR"));
        expect(useSwrPrincipal.slice(0, 260)).not.toContain("bust=1");
    });
});

/**
 * "Carga los datos y despues los pierde" (prod, 2026-09-15). El payload bueno
 * estaba cacheado y se mostraba; al refrescar, el ensamblado corria con Cost
 * Management throttleado, devolvia 0 SIN tirar error, y ese 0 se guardaba
 * encima del bueno. El numero aparecia y desaparecia.
 *
 * Son dos capas de cache distintas y las dos tenian el mismo agujero.
 */
describe("un cero degradado no pisa al ultimo valor bueno", () => {
    const inteligencia = sin("src/app/api/intelligence/whiteboard/route.ts");
    const overview = sin("src/app/api/overview/whiteboard/route.ts");

    it("el SWR de inteligencia no cachea un degradado en cero", () => {
        // `getWithStaleWhileRevalidate` entiende ttl <= 0 como "no guardes esto
        // y tampoco borres lo que ya esta". Antes devolvia 3600 y lo pisaba.
        expect(inteligencia).toMatch(/if \(mtd === 0 && result\?\._costDegraded\) return 0;/);
    });

    it("el cero SIN degradacion si se cachea: es un dato, no una falla", () => {
        // Un tenant que de verdad no gasto tiene que poder cachear su cero.
        expect(inteligencia).toMatch(/if \(mtd === 0 \|\| result\?\._costDegraded\) return 3600;/);
    });

    it("el refresco NO borra el payload bueno antes de buscar", () => {
        // Borrarlo primero era lo que hacia que el boton Actualizar perdiera el
        // dato: si el recalculo volvia en cero, ya no habia a que caer.
        const bloqueBust = overview.slice(overview.indexOf("const bust ="), overview.indexOf("const leerCache"));
        expect(bloqueBust).not.toMatch(/redis\.del\(cacheKey\)/);
        // Las del ensamblado si se borran: es lo que el boton promete.
        expect(bloqueBust).toContain("whiteboard:v5:azure:");
    });

    it("overview conserva el previo cuando lo fresco viene degradado y en cero", () => {
        expect(overview).toContain("degradadoEnCero(payload) && previo && !degradadoEnCero(previo.payload)");
    });

    it("si el ensamblado se cae entero, sirve el previo en vez de un 500", () => {
        const bloqueCatch = overview.slice(overview.lastIndexOf("catch (err)"));
        expect(bloqueCatch).toMatch(/if \(previo\)/);
    });
});

describe("un tenant sin permiso recibe 401, no 500", () => {
    const overview = sin("src/app/api/overview/whiteboard/route.ts");

    it("la verificacion de acceso no queda fuera de un try", () => {
        // El await iba suelto: el AuthError escapaba del handler y Next
        // respondia 500. El cliente no podia distinguir "no tenes acceso" de
        // "el servidor se rompio", y ensuciaba las alertas de 5xx.
        const bloque = overview.slice(
            overview.indexOf("if (!forceMock && !isMockTenant(tenantId))"),
            overview.indexOf("const cacheKey"),
        );
        expect(bloque).toContain("try {");
        expect(bloque).toContain("error instanceof AuthError");
        expect(bloque).toContain("status: error.status");
    });
});
