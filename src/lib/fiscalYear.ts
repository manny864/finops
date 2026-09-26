/**
 * MEJ-36 — el año fiscal del tenant, y el arrastre de presupuesto.
 *
 * ESTO ARREGLA ALGO QUE ESTABA MAL EN SILENCIO. El año fiscal estaba cableado a
 * enero en cuatro lugares (`whiteboard`, el período `fy` de `cost-groups`, y
 * `getCurrentFY`/`getPeriodComparison` del detalle). Para un cliente cuyo
 * ejercicio arranca en abril, TODOS los acumulados anuales de la plataforma
 * estaban corridos tres meses — y no lo decía en ningún lado, que es lo peor de
 * los dos: un número equivocado que se presenta como correcto.
 *
 * NO TODO "DESDE EL 1 DE ENERO" ES UN AÑO FISCAL. El `ytd` del Invoicing Report
 * (`invoicingPeriod.ts`) significa literalmente "año en curso desde el 1 de
 * enero" y es una opción con ese nombre: hacerlo seguir al ejercicio del cliente
 * sería redefinir en silencio lo que el usuario eligió. Queda como está.
 *
 * VIVE EN UN SOLO LUGAR a propósito. El panel, las alertas y los reportes
 * consumen los mismos dos cálculos; si cada uno los rehace, divergen. Es el
 * patrón que MEJ-32 documenta como recurrente en este repo — tres catálogos de
 * precios duplicados y ya divergidos.
 */

import pool from "@/modules/storage/db";

function pad2(n: number): string {
    return String(n).padStart(2, "0");
}

/** Enero cuando no hay nada configurado: es el comportamiento de siempre. */
export const MES_FISCAL_POR_DEFECTO = 1;

/** Normaliza el mes de inicio a 1..12. Un valor basura cae a enero, no revienta. */
export function mesFiscalValido(mes: unknown): number {
    const n = Math.trunc(Number(mes));
    return Number.isFinite(n) && n >= 1 && n <= 12 ? n : MES_FISCAL_POR_DEFECTO;
}

export interface RangoFiscal {
    /** `YYYY-MM-DD` inclusive. */
    start: string;
    /** `YYYY-MM-DD` inclusive. */
    end: string;
    /**
     * El año por el que se nombra el ejercicio. Se usa el año de INICIO —un
     * ejercicio que arranca en abril de 2026 es "2026"— porque es la convención
     * que ya usaba el código con enero, y cambiarla renombraría los ejercicios
     * históricos de todos los tenants que hoy están en calendario.
     */
    anio: number;
    /** Días que lleva corridos el ejercicio a la fecha de referencia, mínimo 1. */
    diasTranscurridos: number;
    /** Días que dura el ejercicio completo (365 o 366). */
    diasTotales: number;
}

/**
 * El ejercicio vigente a una fecha, para un mes de inicio dado.
 *
 * Con `mesInicio = 4` y hoy 15 de febrero de 2026, el ejercicio corriente
 * arrancó el 1 de abril de 2025 y termina el 31 de marzo de 2026 — no empezó
 * hace mes y medio.
 */
export function rangoDelAnioFiscal(mesInicio: number, referencia: Date = new Date()): RangoFiscal {
    const mes = mesFiscalValido(mesInicio);
    const mesDeHoy = referencia.getUTCMonth() + 1;
    const anio = mesDeHoy >= mes ? referencia.getUTCFullYear() : referencia.getUTCFullYear() - 1;
    return construir(anio, mes, referencia);
}

/** El ejercicio ANTERIOR al vigente, para comparar contra el mismo tramo. */
export function rangoDelAnioFiscalAnterior(mesInicio: number, referencia: Date = new Date()): RangoFiscal {
    const actual = rangoDelAnioFiscal(mesInicio, referencia);
    return construir(actual.anio - 1, mesFiscalValido(mesInicio), referencia);
}

function construir(anio: number, mes: number, referencia: Date): RangoFiscal {
    const inicio = Date.UTC(anio, mes - 1, 1);
    // El día 0 del mes siguiente al de inicio, un año después: el último día del
    // ejercicio. Restar un día a mano se rompe en años bisiestos.
    const fin = Date.UTC(anio + 1, mes - 1, 0);
    const dia = 86_400_000;
    const diasTotales = Math.round((fin - inicio) / dia) + 1;
    const transcurridos = Math.floor((referencia.getTime() - inicio) / dia) + 1;
    return {
        start: `${anio}-${pad2(mes)}-01`,
        end: new Date(fin).toISOString().slice(0, 10),
        anio,
        // Acotado a [1, diasTotales]: sin esto, una proyección sobre un ejercicio
        // que todavía no empezó divide por un número negativo.
        diasTranscurridos: Math.min(Math.max(1, transcurridos), diasTotales),
        diasTotales,
    };
}

export interface ArrastreMensual {
    /** El presupuesto propio del mes, sin arrastre. */
    base: number;
    /** Lo que se arrastró de los meses anteriores del ejercicio. */
    arrastre: number;
    /** Lo que efectivamente se puede gastar: base + arrastre. */
    efectivo: number;
}

/**
 * MEJ-36 — el arrastre de presupuesto no ejecutado.
 *
 * `gastosPrevios` son los gastos de los meses ANTERIORES del ejercicio, en
 * orden. Devuelve el presupuesto del mes en curso con lo que se arrastra.
 *
 * DOS REGLAS QUE NO SON OBVIAS:
 *
 *   - **Un mes en rojo arrastra cero, no negativo.** Endeudar al mes siguiente
 *     con el sobregiro del anterior es una decisión financiera que nadie tomó, y
 *     convierte un desvío puntual en una cadena de meses en rojo que no se puede
 *     leer.
 *   - **El tope se aplica en cada paso**, no al final. Con tope de 1.000 y tres
 *     meses sin gastar nada de un presupuesto de 800, aplicarlo al final daría
 *     1.000; aplicarlo por paso también, pero el intermedio nunca supera el tope
 *     y eso es lo que el panel muestra mes a mes.
 */
export function arrastreDelMes(
    base: number,
    gastosPrevios: number[],
    opciones: { habilitado: boolean; tope?: number | null },
): ArrastreMensual {
    const presupuesto = Number(base) || 0;
    if (!opciones.habilitado) {
        return { base: presupuesto, arrastre: 0, efectivo: presupuesto };
    }
    const tope = opciones.tope == null ? Infinity : Math.max(0, Number(opciones.tope) || 0);

    let arrastre = 0;
    for (const gasto of gastosPrevios || []) {
        const sobrante = presupuesto + arrastre - (Number(gasto) || 0);
        arrastre = Math.min(tope, Math.max(0, sobrante));
    }
    return {
        base: presupuesto,
        arrastre: Number(arrastre.toFixed(2)),
        efectivo: Number((presupuesto + arrastre).toFixed(2)),
    };
}

/**
 * El mes en que arranca el ejercicio del tenant.
 *
 * FALLA A ENERO, que es el comportamiento de siempre: si la columna no existe
 * todavia --un entorno sin la migracion-- lo que se pierde es la configuracion,
 * no el tablero.
 */
export async function mesFiscalDelTenant(tenantId: string): Promise<number> {
    if (!tenantId) return MES_FISCAL_POR_DEFECTO;
    try {
        const [rows] = await pool.query<any[]>(
            `SELECT fiscal_year_start_month FROM Tenants WHERE tenant_id = ? LIMIT 1`,
            [tenantId],
        );
        return mesFiscalValido(rows?.[0]?.fiscal_year_start_month);
    } catch {
        return MES_FISCAL_POR_DEFECTO;
    }
}
