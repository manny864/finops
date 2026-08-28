/**
 * Cálculo de costo acumulado (MTD) y proyección a fin de mes.
 *
 * Motivo: los cockpits mostraban el precio de lista MENSUAL bajo la etiqueta
 * "Costo MTD Acumulado / Facturación mes en curso". Un App Service Plan creado
 * hoy figuraba con $43.80 acumulados cuando llevaba horas de vida, porque ese
 * es el precio del mes entero. Y el "Forecast Fin de Mes" era ese mismo número
 * por un multiplicador fijo (×1.08), no una proyección.
 *
 * Las funciones son puras y sin dependencias para poder testear la aritmética
 * sin tocar Azure ni la base.
 */

/**
 * Fecha de creación de un recurso a partir de sus `properties` de ARM.
 *
 * Cada familia de recursos la expone con otro nombre — los App Service Plans
 * usan `createdTime`, la mayoría de los tipos de cómputo `timeCreated`, y los
 * tipos nuevos la traen en `systemData.createdAt`. Se prueban en orden y se
 * devuelve null si ninguno está: no todos los tipos la publican.
 */
export function extractResourceCreatedAt(
    properties?: Record<string, unknown> | null,
    systemData?: Record<string, unknown> | null,
): Date | null {
    const candidates = [
        properties?.createdTime,
        properties?.timeCreated,
        properties?.creationTime,
        properties?.creationDate,
        systemData?.createdAt,
    ];

    for (const candidate of candidates) {
        if (typeof candidate !== "string" && !(candidate instanceof Date)) continue;
        const parsed = candidate instanceof Date ? candidate : new Date(candidate);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return null;
}

/** Días del mes al que pertenece `now` (28-31). */
export function daysInMonth(now: Date): number {
    return new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getUTCDate();
}

/**
 * Fracción del mes ya transcurrida, en días, con la parte proporcional del día
 * en curso. El día 1 a las 06:00 devuelve 0.25, no 1: si se redondeara hacia
 * arriba, el primer día del mes inflaría todo el prorrateo.
 *
 * Nunca devuelve 0 — se acota a una hora — porque es divisor del run-rate.
 */
export function daysElapsedInMonth(now: Date): number {
    const startOfMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const elapsedMs = now.getTime() - startOfMonth;
    const elapsedDays = elapsedMs / 86_400_000;
    return Math.max(1 / 24, elapsedDays);
}

/**
 * Días que el recurso estuvo facturando dentro del mes en curso.
 *
 * Un recurso creado a mitad de mes no acumuló el mes entero: se cuenta desde su
 * creación. Sin esto, un plan creado hoy aparecía con el acumulado de alguien
 * que existe hace 28 días.
 */
export function billableDaysInMonth(now: Date, createdAt?: Date | string | null): number {
    const elapsed = daysElapsedInMonth(now);
    if (!createdAt) return elapsed;

    const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
    if (Number.isNaN(created.getTime())) return elapsed;

    // Creado antes de este mes: facturó todo lo transcurrido.
    const startOfMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    if (created.getTime() <= startOfMonth) return elapsed;

    // Creado en el futuro (reloj desfasado): no acumuló nada todavía.
    if (created.getTime() >= now.getTime()) return 1 / 24;

    return Math.max(1 / 24, (now.getTime() - created.getTime()) / 86_400_000);
}

/**
 * Convierte una tarifa MENSUAL (precio de lista de un SKU) en el acumulado que
 * le corresponde al mes en curso.
 *
 * Se usa sólo como respaldo cuando Cost Management todavía no tiene datos del
 * recurso — típicamente sus primeras horas de vida, que es justo cuando el
 * número sin prorratear era más engañoso.
 */
export function prorateMonthlyRateToMtd(
    monthlyRate: number,
    now: Date,
    createdAt?: Date | string | null,
): number {
    if (!Number.isFinite(monthlyRate) || monthlyRate <= 0) return 0;
    const billable = billableDaysInMonth(now, createdAt);
    const total = daysInMonth(now);
    const value = (monthlyRate * Math.min(billable, total)) / total;
    return Math.round(value * 100) / 100;
}

/**
 * Proyección a fin de mes por run-rate: se extrapola el gasto real acumulado
 * al resto del mes.
 *
 * Reemplaza a los multiplicadores fijos (×1.08, ×1.06, ×1.05) que había en los
 * boards, que no eran proyecciones sino el mismo número inflado un porcentaje
 * arbitrario.
 *
 * `createdAt` importa: para un recurso de 2 días, el run-rate debe calcularse
 * sobre esos 2 días de vida, no sobre los días transcurridos del mes.
 */
export function forecastMonthEnd(
    mtdCost: number,
    now: Date,
    createdAt?: Date | string | null,
): number {
    if (!Number.isFinite(mtdCost) || mtdCost <= 0) return 0;
    const billable = billableDaysInMonth(now, createdAt);
    const total = daysInMonth(now);
    const remaining = Math.max(0, total - daysElapsedInMonth(now));
    const dailyRate = mtdCost / billable;
    const value = mtdCost + dailyRate * remaining;
    return Math.round(value * 100) / 100;
}

/**
 * Tarifa MENSUAL equivalente a partir del acumulado: cuánto costaría el recurso
 * en un mes completo al ritmo actual.
 *
 * No es lo mismo que `forecastMonthEnd`. Para un recurso creado el día 28, la
 * proyección de ese mes son ~3 días de gasto, mientras que su tarifa mensual es
 * la de los 31 días. Los cálculos de AHORRO usan esta última: "migrar de SKU te
 * ahorra X por mes" es una cifra mensual, no la fracción que quede del mes en
 * curso — con el acumulado se subestimaba, y los umbrales del tipo `costo > 40`
 * dejaban de dispararse, haciendo desaparecer recomendaciones válidas.
 */
export function monthlyRunRate(
    mtdCost: number,
    now: Date,
    createdAt?: Date | string | null,
): number {
    if (!Number.isFinite(mtdCost) || mtdCost <= 0) return 0;
    const billable = billableDaysInMonth(now, createdAt);
    const value = (mtdCost / billable) * daysInMonth(now);
    return Math.round(value * 100) / 100;
}

/**
 * Banda de confianza de la proyección.
 *
 * Se ensancha cuando hay pocos días de historia: proyectar el mes entero desde
 * medio día de datos es mucho menos confiable que desde tres semanas, y antes
 * la banda era un ±4% fijo que no lo reflejaba.
 */
export function forecastRange(
    mtdCost: number,
    now: Date,
    createdAt?: Date | string | null,
): { low: number; high: number } {
    const point = forecastMonthEnd(mtdCost, now, createdAt);
    if (point <= 0) return { low: 0, high: 0 };

    const billable = billableDaysInMonth(now, createdAt);
    // 4% con un mes de datos, ~30% con un solo día.
    const uncertainty = Math.min(0.35, 0.04 + 0.3 / Math.max(1, billable));
    return {
        low: Math.round(point * (1 - uncertainty) * 100) / 100,
        high: Math.round(point * (1 + uncertainty) * 100) / 100,
    };
}

/**
 * Ahorro potencial de un recurso, acotado a lo que ese recurso realmente cuesta.
 *
 * Las recomendaciones son en buena medida EXCLUYENTES entre sí: si se elimina un
 * App Service Plan huérfano no se le puede además bajar el SKU. Sumarlas todas
 * daba cifras por encima del gasto — un plan de $158/mes mostraba $214 de
 * "ahorro potencial", más que el propio forecast de fin de mes, que es
 * imposible y destruye la credibilidad del número.
 *
 * El techo es la tarifa mensual: el ahorro máximo de un recurso es no tenerlo.
 */
export function cappedMonthlySavings(
    savings: number[],
    monthlyRateUsd: number,
): number {
    const total = savings.reduce((acc, s) => acc + (Number.isFinite(s) ? s : 0), 0);
    if (!Number.isFinite(monthlyRateUsd) || monthlyRateUsd <= 0) {
        return Math.round(Math.max(0, total) * 100) / 100;
    }
    return Math.round(Math.max(0, Math.min(total, monthlyRateUsd)) * 100) / 100;
}
