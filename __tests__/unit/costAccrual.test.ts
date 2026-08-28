// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
    daysInMonth,
    daysElapsedInMonth,
    billableDaysInMonth,
    prorateMonthlyRateToMtd,
    forecastMonthEnd,
    forecastRange,
    extractResourceCreatedAt,
    monthlyRunRate,
    cappedMonthlySavings,
} from "@/lib/costAccrual";

const utc = (iso: string) => new Date(iso);

describe("extractResourceCreatedAt", () => {
    // Valor real de cscs-asp-wus2-prod en Resource Graph.
    it("lee createdTime de un App Service Plan", () => {
        const d = extractResourceCreatedAt({ createdTime: "2026-08-28T16:35:48.316Z" });
        expect(d?.toISOString()).toBe("2026-08-28T16:35:48.316Z");
    });

    it("acepta las otras variantes que usa Azure según el tipo", () => {
        expect(extractResourceCreatedAt({ timeCreated: "2026-01-02T00:00:00Z" })?.getUTCDate()).toBe(2);
        expect(extractResourceCreatedAt({ creationTime: "2026-01-03T00:00:00Z" })?.getUTCDate()).toBe(3);
        expect(extractResourceCreatedAt({ creationDate: "2026-01-04T00:00:00Z" })?.getUTCDate()).toBe(4);
        expect(extractResourceCreatedAt(null, { createdAt: "2026-01-05T00:00:00Z" })?.getUTCDate()).toBe(5);
    });

    it("devuelve null si el tipo no publica la fecha", () => {
        expect(extractResourceCreatedAt({ numberOfWorkers: 1 })).toBeNull();
        expect(extractResourceCreatedAt(null, null)).toBeNull();
        expect(extractResourceCreatedAt(undefined, undefined)).toBeNull();
    });

    it("ignora valores presentes pero no parseables", () => {
        expect(extractResourceCreatedAt({ createdTime: "n/a" })).toBeNull();
        expect(extractResourceCreatedAt({ createdTime: null })).toBeNull();
        expect(extractResourceCreatedAt({ createdTime: 12345 })).toBeNull();
    });
});

describe("daysInMonth", () => {
    it("resuelve meses de 31, 30 y 28 días", () => {
        expect(daysInMonth(utc("2026-01-15T00:00:00Z"))).toBe(31);
        expect(daysInMonth(utc("2026-04-15T00:00:00Z"))).toBe(30);
        expect(daysInMonth(utc("2026-02-15T00:00:00Z"))).toBe(28);
    });

    it("contempla febrero bisiesto", () => {
        expect(daysInMonth(utc("2024-02-15T00:00:00Z"))).toBe(29);
    });
});

describe("daysElapsedInMonth", () => {
    it("cuenta la fracción del día en curso", () => {
        // Día 1 a las 06:00 = un cuarto de día, no un día entero.
        expect(daysElapsedInMonth(utc("2026-08-01T06:00:00Z"))).toBeCloseTo(0.25, 5);
        expect(daysElapsedInMonth(utc("2026-08-11T12:00:00Z"))).toBeCloseTo(10.5, 5);
    });

    it("nunca devuelve 0 — es divisor del run-rate", () => {
        const atMidnight = daysElapsedInMonth(utc("2026-08-01T00:00:00Z"));
        expect(atMidnight).toBeGreaterThan(0);
        expect(atMidnight).toBeCloseTo(1 / 24, 5);
    });
});

describe("billableDaysInMonth", () => {
    it("un recurso viejo factura todo lo transcurrido del mes", () => {
        const now = utc("2026-08-11T00:00:00Z");
        expect(billableDaysInMonth(now, utc("2024-01-01T00:00:00Z"))).toBeCloseTo(10, 5);
    });

    it("un recurso creado a mitad de mes cuenta desde su creación", () => {
        const now = utc("2026-08-11T00:00:00Z");
        expect(billableDaysInMonth(now, utc("2026-08-09T00:00:00Z"))).toBeCloseTo(2, 5);
    });

    // El caso reportado: plan creado hoy mostrando el acumulado de un mes.
    it("un recurso creado hoy factura horas, no días", () => {
        const now = utc("2026-08-28T18:00:00Z");
        expect(billableDaysInMonth(now, utc("2026-08-28T12:00:00Z"))).toBeCloseTo(0.25, 5);
    });

    it("sin fecha de creación cae a los días transcurridos", () => {
        const now = utc("2026-08-11T00:00:00Z");
        expect(billableDaysInMonth(now, null)).toBeCloseTo(10, 5);
        expect(billableDaysInMonth(now, undefined)).toBeCloseTo(10, 5);
    });

    it("una fecha inválida no rompe el cálculo", () => {
        const now = utc("2026-08-11T00:00:00Z");
        expect(billableDaysInMonth(now, "no-es-una-fecha")).toBeCloseTo(10, 5);
    });

    it("una fecha futura no acumula nada", () => {
        const now = utc("2026-08-11T00:00:00Z");
        expect(billableDaysInMonth(now, utc("2026-08-20T00:00:00Z"))).toBeCloseTo(1 / 24, 5);
    });
});

describe("prorateMonthlyRateToMtd", () => {
    // El bug exacto: S1 Linux 1 worker = $43.80/mes de lista, creado hoy.
    it("un plan creado hoy no acumula el mes entero", () => {
        const now = utc("2026-08-28T18:00:00Z");
        const mtd = prorateMonthlyRateToMtd(43.8, now, utc("2026-08-28T00:00:00Z"));
        // 0.75 días de 31 -> ~1.06, no 43.80.
        expect(mtd).toBeCloseTo(1.06, 2);
        expect(mtd).toBeLessThan(43.8);
    });

    it("a mes cumplido converge a la tarifa mensual", () => {
        const now = utc("2026-08-31T23:59:59Z");
        expect(prorateMonthlyRateToMtd(43.8, now, utc("2024-01-01T00:00:00Z"))).toBeCloseTo(43.8, 1);
    });

    it("a mitad de mes acumula la mitad", () => {
        const now = utc("2026-04-16T00:00:00Z"); // abril: 30 días
        expect(prorateMonthlyRateToMtd(60, now, utc("2024-01-01T00:00:00Z"))).toBeCloseTo(30, 1);
    });

    it("nunca supera la tarifa mensual", () => {
        const now = utc("2026-08-31T23:59:59Z");
        expect(prorateMonthlyRateToMtd(43.8, now, utc("2020-01-01T00:00:00Z"))).toBeLessThanOrEqual(43.8);
    });

    it("tarifas no positivas o inválidas devuelven 0", () => {
        const now = utc("2026-08-15T00:00:00Z");
        expect(prorateMonthlyRateToMtd(0, now)).toBe(0);
        expect(prorateMonthlyRateToMtd(-5, now)).toBe(0);
        expect(prorateMonthlyRateToMtd(NaN, now)).toBe(0);
    });
});

describe("forecastMonthEnd", () => {
    it("extrapola por run-rate, no por un multiplicador fijo", () => {
        // $10 en 10 días de un mes de 31 -> $1/día -> ~$31.
        const now = utc("2026-08-11T00:00:00Z");
        expect(forecastMonthEnd(10, now, utc("2024-01-01T00:00:00Z"))).toBeCloseTo(31, 0);
    });

    it("usa la vida del recurso, no los días del mes", () => {
        // $10 gastados en 2 días de vida -> $5/día -> 10 + 5*21 = 115.
        const now = utc("2026-08-11T00:00:00Z");
        const f = forecastMonthEnd(10, now, utc("2026-08-09T00:00:00Z"));
        expect(f).toBeCloseTo(115, 0);
    });

    it("a fin de mes la proyección converge al acumulado", () => {
        const now = utc("2026-08-31T23:00:00Z");
        expect(forecastMonthEnd(100, now, utc("2024-01-01T00:00:00Z"))).toBeCloseTo(100, 0);
    });

    it("nunca es menor al acumulado", () => {
        for (const day of ["2026-08-02", "2026-08-15", "2026-08-28"]) {
            const now = utc(`${day}T12:00:00Z`);
            expect(forecastMonthEnd(50, now, utc("2024-01-01T00:00:00Z"))).toBeGreaterThanOrEqual(50);
        }
    });

    it("sin gasto no proyecta gasto", () => {
        expect(forecastMonthEnd(0, utc("2026-08-15T00:00:00Z"))).toBe(0);
    });
});

describe("forecastRange", () => {
    it("la banda contiene la proyección", () => {
        const now = utc("2026-08-15T00:00:00Z");
        const point = forecastMonthEnd(100, now, utc("2024-01-01T00:00:00Z"));
        const { low, high } = forecastRange(100, now, utc("2024-01-01T00:00:00Z"));
        expect(low).toBeLessThanOrEqual(point);
        expect(high).toBeGreaterThanOrEqual(point);
    });

    // Antes la banda era ±4% fija, igual con medio día de datos que con un mes.
    it("se ensancha cuando hay pocos días de historia", () => {
        const now = utc("2026-08-28T00:00:00Z");
        const anchoConUnDia = forecastRange(10, now, utc("2026-08-27T00:00:00Z"));
        const anchoConMesEntero = forecastRange(10, now, utc("2024-01-01T00:00:00Z"));
        const spread = (r: { low: number; high: number }) => r.high - r.low;
        expect(spread(anchoConUnDia) / anchoConUnDia.high).toBeGreaterThan(
            spread(anchoConMesEntero) / anchoConMesEntero.high,
        );
    });

    it("sin gasto la banda es cero", () => {
        expect(forecastRange(0, utc("2026-08-15T00:00:00Z"))).toEqual({ low: 0, high: 0 });
    });
});

/**
 * Regresión del caso reportado: el App Service Plan `cscs-asp-wus2-prod`
 * (Standard, Linux, 1 worker) fue creado el 2026-08-28 y la UI mostraba
 * "Costo MTD Acumulado $43.80 / Facturación mes en curso" con un
 * "Forecast Fin de Mes" de $47.30.
 *
 * $43.80 es el precio de lista MENSUAL del SKU, y $47.30 era ese mismo número
 * por 1.08. Ninguno de los dos era el gasto del mes en curso.
 */
describe("regresión: plan creado hoy mostraba el precio mensual como acumulado", () => {
    const LISTA_S1_LINUX = 43.8;
    const CREADO = utc("2026-08-28T16:35:48.316Z"); // valor real de Resource Graph
    const AHORA = utc("2026-08-28T20:35:48.316Z"); // 4 horas después

    it("el acumulado son las horas de vida, no el mes entero", () => {
        const mtd = prorateMonthlyRateToMtd(LISTA_S1_LINUX, AHORA, CREADO);
        expect(mtd).toBeLessThan(1);
        expect(mtd).not.toBeCloseTo(43.8, 1);
    });

    it("la proyección ya no es el acumulado por un multiplicador fijo", () => {
        const mtd = prorateMonthlyRateToMtd(LISTA_S1_LINUX, AHORA, CREADO);
        expect(forecastMonthEnd(mtd, AHORA, CREADO)).not.toBeCloseTo(mtd * 1.08, 2);
    });

    it("la proyección de agosto son los días que el plan existe, no el mes entero", () => {
        // Creado el 28 a las 16:35, el plan sólo vive ~3.3 días de agosto. Su
        // factura de agosto es esa fracción del precio mensual (~$4.7), no
        // $43.80: ese sería el costo de un mes completo, que recién se dará en
        // septiembre.
        const mtd = prorateMonthlyRateToMtd(LISTA_S1_LINUX, AHORA, CREADO);
        const eom = forecastMonthEnd(mtd, AHORA, CREADO);
        const tarifaDiaria = LISTA_S1_LINUX / 31;
        const diasDeVidaEnAgosto = 3.31;

        expect(eom).toBeCloseTo(tarifaDiaria * diasDeVidaEnAgosto, 0);
        expect(eom).toBeLessThan(LISTA_S1_LINUX / 5);
    });

    it("el run-rate diario sí coincide con la tarifa de lista", () => {
        // Validación de que prorrateo y proyección son consistentes: el gasto
        // por día implícito tiene que ser el precio mensual dividido el mes.
        const mtd = prorateMonthlyRateToMtd(LISTA_S1_LINUX, AHORA, CREADO);
        const diasDeVida = 4 / 24;
        expect(mtd / diasDeVida).toBeCloseTo(LISTA_S1_LINUX / 31, 1);
    });

    it("la fecha de creación sale de properties.createdTime", () => {
        const props = { createdTime: "2026-08-28T16:35:48.316Z", numberOfWorkers: 1 };
        expect(extractResourceCreatedAt(props)?.toISOString()).toBe(CREADO.toISOString());
    });
});

describe("monthlyRunRate", () => {
    it("recupera la tarifa mensual desde el acumulado", () => {
        // Prorrateo y run-rate mensual son inversos: 43.80/mes prorrateado a
        // 4 horas y devuelto a mes completo tiene que volver a ~43.80.
        //
        // La vuelta no es exacta y no puede serlo: el prorrateo redondea a
        // centavos ($0.2355 -> $0.24) y volver a escalar por 1/0.17 amplifica
        // ese redondeo. A magnitudes de centavos el error ronda el 2%, así que
        // se verifica una tolerancia relativa y no una igualdad.
        const ahora = utc("2026-08-28T20:35:48.316Z");
        const creado = utc("2026-08-28T16:35:48.316Z");
        const mtd = prorateMonthlyRateToMtd(43.8, ahora, creado);
        const recuperado = monthlyRunRate(mtd, ahora, creado);
        expect(Math.abs(recuperado - 43.8) / 43.8).toBeLessThan(0.03);
    });

    it("el redondeo deja de importar cuando el acumulado es de varios dólares", () => {
        // Con más días de vida el acumulado ya no está en centavos y la vuelta
        // es prácticamente exacta.
        const ahora = utc("2026-08-20T00:00:00Z");
        const creado = utc("2026-08-05T00:00:00Z");
        const mtd = prorateMonthlyRateToMtd(438, ahora, creado);
        expect(monthlyRunRate(mtd, ahora, creado)).toBeCloseTo(438, 0);
    });

    it("no es lo mismo que la proyección de fin de mes", () => {
        // Un recurso creado el 28 proyecta ~3 días para agosto, pero su tarifa
        // mensual sigue siendo la de los 31 días. Los ahorros usan la segunda.
        const ahora = utc("2026-08-28T20:00:00Z");
        const creado = utc("2026-08-28T16:00:00Z");
        const mtd = prorateMonthlyRateToMtd(43.8, ahora, creado);
        expect(forecastMonthEnd(mtd, ahora, creado)).toBeLessThan(10);
        expect(monthlyRunRate(mtd, ahora, creado)).toBeGreaterThan(40);
    });

    it("para un recurso de mes completo coincide con el acumulado", () => {
        const ahora = utc("2026-08-31T23:59:00Z");
        expect(monthlyRunRate(50, ahora, utc("2024-01-01T00:00:00Z"))).toBeCloseTo(50, 0);
    });

    it("sin gasto devuelve 0", () => {
        expect(monthlyRunRate(0, utc("2026-08-15T00:00:00Z"))).toBe(0);
    });
});

describe("cappedMonthlySavings", () => {
    /**
     * Reportado: un plan mostraba $187.06 de ahorro potencial contra un forecast
     * de fin de mes de $159.20. Salía de sumar recomendaciones excluyentes —
     * "eliminar el plan" (100%) más "bajar el SKU" (35%) — que no se pueden
     * aplicar a la vez.
     */
    it("no permite ahorrar más de lo que el recurso cuesta", () => {
        // Eliminar el plan ($158.73) + bajar SKU ($55.56) = $214.29 > costo.
        expect(cappedMonthlySavings([158.73, 55.56], 158.73)).toBe(158.73);
    });

    it("deja pasar el total cuando está por debajo del costo", () => {
        expect(cappedMonthlySavings([10, 15], 100)).toBe(25);
    });

    it("sin tarifa conocida no inventa un tope", () => {
        expect(cappedMonthlySavings([10, 15], 0)).toBe(25);
        expect(cappedMonthlySavings([10, 15], NaN)).toBe(25);
    });

    it("nunca devuelve negativo", () => {
        expect(cappedMonthlySavings([-5], 100)).toBe(0);
        expect(cappedMonthlySavings([], 100)).toBe(0);
    });

    it("ignora valores no finitos sin romper la suma", () => {
        expect(cappedMonthlySavings([10, NaN, 5], 100)).toBe(15);
    });
});
