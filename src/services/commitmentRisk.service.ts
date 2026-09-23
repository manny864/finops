import Decimal from "decimal.js";
import type { ActiveReservationDetail } from "@/services/reservationService";

/**
 * MEJ-40 — riesgo de la cartera de compromisos: cuánto vence junto.
 *
 * Que toda la cartera venza el mismo mes es riesgo concentrado, y hoy no se
 * mide en ningún lado. Si vencen 40.000 dólares de reservas en marzo y nadie lo
 * vio venir, en abril la factura sube a precio de lista mientras alguien corre a
 * conseguir la aprobación de la recompra.
 *
 * PONDERADO POR VALOR, NO POR CANTIDAD. Diez reservas chicas que vencen juntas
 * no son el mismo riesgo que una grande: contar reservas daría la misma alarma
 * para los dos casos y la alarma dejaría de significar algo. El valor sale de
 * unir `reservationDetails` (Microsoft.Capacity: nombre, vencimiento) con
 * `activeReservations` (Cost Management agrupado por ReservationName: costo).
 *
 * Lo que no se puede resolver se INFORMA, no se cuenta como cero. Una reserva
 * cuyo costo no se pudo unir sumaría 0 al mes en que vence y bajaría el
 * porcentaje de concentración: el riesgo se vería más chico de lo que es, que es
 * el error que no puede cometer una pantalla de riesgo.
 */

export interface ReservaConCosto {
    reservationName: string;
    cost: number;
}

export interface VencimientoDelMes {
    /** `YYYY-MM`. */
    mes: string;
    valorMensual: number;
    reservas: number;
}

export interface ConcentracionVencimientos {
    porMes: VencimientoDelMes[];
    valorMensualTotal: number;
    /** El mes que concentra más valor, y qué porcentaje del total es. */
    peorMes: { mes: string; porcentaje: number; valorMensual: number } | null;
    /**
     * La peor ventana de 3 meses CORRIDOS, no el trimestre de calendario: un
     * acantilado que cae entre diciembre y enero sigue siendo un acantilado, y
     * partirlo por año fiscal lo escondería.
     */
    peorVentana3m: { desde: string; hasta: string; porcentaje: number } | null;
    /** Reservas con vencimiento pero sin costo resoluble. */
    sinValor: number;
    /** Reservas sin fecha de vencimiento informada por Azure. */
    sinFecha: number;
}

const VACIO: ConcentracionVencimientos = {
    porMes: [], valorMensualTotal: 0, peorMes: null, peorVentana3m: null, sinValor: 0, sinFecha: 0,
};

function claveDeMes(iso: string): string | null {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Normaliza para unir: Cost Management y Microsoft.Capacity no siempre coinciden en mayúsculas ni espacios. */
function normalizar(nombre: unknown): string {
    return String(nombre || "").trim().toLowerCase();
}

function siguienteMes(clave: string): string {
    const [a, m] = clave.split("-").map(Number);
    const d = new Date(Date.UTC(a, m, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function concentracionDeVencimientos(
    detalles: ActiveReservationDetail[] | null | undefined,
    conCosto: ReservaConCosto[] | null | undefined,
): ConcentracionVencimientos {
    if (!Array.isArray(detalles) || detalles.length === 0) return { ...VACIO };

    const costos = new Map<string, number>();
    for (const r of conCosto || []) {
        const k = normalizar(r?.reservationName);
        if (!k) continue;
        costos.set(k, (costos.get(k) || 0) + (Number(r?.cost) || 0));
    }

    const porMes = new Map<string, { valor: Decimal; reservas: number }>();
    let sinValor = 0;
    let sinFecha = 0;
    let total = new Decimal(0);

    for (const d of detalles) {
        const estado = String(d?.status || "").toLowerCase();
        // Una reserva ya vencida no es riesgo futuro: el golpe ya pasó.
        if (estado.includes("expired") || estado.includes("cancel")) continue;

        if (!d?.expiryDate) { sinFecha++; continue; }
        const mes = claveDeMes(d.expiryDate);
        if (!mes) { sinFecha++; continue; }

        const costo = costos.get(normalizar(d.name));
        if (costo === undefined || costo <= 0) { sinValor++; continue; }

        const entrada = porMes.get(mes) || { valor: new Decimal(0), reservas: 0 };
        entrada.valor = entrada.valor.plus(costo);
        entrada.reservas += 1;
        porMes.set(mes, entrada);
        total = total.plus(costo);
    }

    if (total.lte(0)) return { ...VACIO, sinValor, sinFecha };

    const meses: VencimientoDelMes[] = [...porMes.entries()]
        .map(([mes, v]) => ({ mes, valorMensual: Number(v.valor.toFixed(4)), reservas: v.reservas }))
        .sort((a, b) => a.mes.localeCompare(b.mes));

    const pct = (v: Decimal | number) => Number(new Decimal(v).dividedBy(total).times(100).toFixed(2));

    const peor = meses.reduce((a, b) => (b.valorMensual > a.valorMensual ? b : a), meses[0]);

    // Ventana de 3 meses corridos: se recorre mes calendario a mes calendario y
    // no la lista de meses con datos, porque dos meses con vencimientos
    // separados por uno vacío NO son una ventana contigua.
    let peorVentana: ConcentracionVencimientos["peorVentana3m"] = null;
    for (const inicio of meses.map((m) => m.mes)) {
        let m = inicio;
        let suma = new Decimal(0);
        let fin = inicio;
        for (let i = 0; i < 3; i++) {
            suma = suma.plus(porMes.get(m)?.valor || 0);
            fin = m;
            m = siguienteMes(m);
        }
        const p = pct(suma);
        if (!peorVentana || p > peorVentana.porcentaje) {
            peorVentana = { desde: inicio, hasta: fin, porcentaje: p };
        }
    }

    return {
        porMes: meses,
        valorMensualTotal: Number(total.toFixed(4)),
        peorMes: { mes: peor.mes, porcentaje: pct(peor.valorMensual), valorMensual: peor.valorMensual },
        peorVentana3m: peorVentana,
        sinValor,
        sinFecha,
    };
}
