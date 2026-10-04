import type { ActiveReservationDetail } from "@/services/reservationService";

/**
 * MEJ-16, criterio 3 — avisar a los 90, 60 y 30 días del vencimiento de cada
 * reserva activa. Una reserva que vence sin que nadie lo note pasa el consumo
 * que cubría a precio de lista de un día para el otro, y la factura sube sin
 * que haya cambiado nada en la infraestructura.
 *
 * POR ESCALÓN Y NO POR DÍA EXACTO. "Avisar cuando falten 90 días" comparado por
 * igualdad se pierde para siempre si el cron no corre ese día. Acá cada reserva
 * cae en el escalón que le toca hoy, y el registro de avisos
 * (`ReservationExpiryNotices`) dice si ese escalón ya se avisó: una corrida
 * perdida se recupera en la siguiente, y ninguna se repite.
 *
 * El vencimiento es parte de la clave del aviso: si la reserva se renueva o se
 * extiende, la fecha cambia y la escalera vuelve a empezar para la nueva.
 */

/** De menor a mayor: el escalón de una reserva es el primero que la cubre. */
export const ESCALONES = [30, 60, 90] as const;
export type Escalon = (typeof ESCALONES)[number];

/**
 * Estados TERMINALES del enum `provisioningState`, verificado en
 * learn.microsoft.com (Reservation - List All, api-version 2022-11-01) el
 * 2026-10-04. Se excluye lo terminal en vez de incluir sólo `Succeeded`: si
 * Azure suma un estado nuevo, preferimos un aviso de más a una reserva que
 * vence en silencio. Split y Merged importan: la reserva original queda con
 * su fecha y las nuevas también, y sin esto se avisaría dos veces.
 */
const TERMINALES = new Set(["cancelled", "expired", "split", "merged", "failed", "billingfailed"]);

export interface AvisoDeVencimiento {
    reservationId: string;
    nombre: string;
    /** `YYYY-MM-DD`, en UTC. */
    vence: string;
    dias: number;
    escalon: Escalon;
    renuevaSola: boolean;
}

/** Días enteros entre hoy y el vencimiento, contados en UTC. */
export function diasHastaVencer(vence: string, hoy: Date): number {
    const [a, m, d] = vence.split("-").map(Number);
    const hoyUtc = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
    return Math.round((Date.UTC(a, m - 1, d) - hoyUtc) / 86_400_000);
}

/** El escalón que le toca a una reserva, o `null` si está fuera de la ventana o ya venció. */
export function escalonPara(dias: number): Escalon | null {
    if (dias < 0) return null;
    return ESCALONES.find((e) => dias <= e) ?? null;
}

export function avisosDeVencimiento(reservas: ActiveReservationDetail[], hoy: Date): AvisoDeVencimiento[] {
    const avisos: AvisoDeVencimiento[] = [];
    for (const r of reservas) {
        const estado = String(r.provisioningState || r.status || "").toLowerCase();
        if (TERMINALES.has(estado)) continue;

        const vence = String(r.expiryDate || "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(vence)) continue;

        const dias = diasHastaVencer(vence, hoy);
        const escalon = escalonPara(dias);
        if (escalon === null) continue;

        avisos.push({
            reservationId: r.reservationId,
            nombre: r.name,
            vence,
            dias,
            escalon,
            renuevaSola: Boolean(r.renew),
        });
    }
    return avisos.sort((a, b) => a.dias - b.dias);
}

/**
 * Qué tan fuerte avisar. Una reserva con renovación automática no deja de
 * cubrir: Azure compra la siguiente el mismo día. La que no la tiene y está a
 * 30 días o menos es la que hay que mirar ya.
 */
export function gravedad(avisos: AvisoDeVencimiento[]): "info" | "warning" | "critical" {
    const sinRenovar = avisos.filter((a) => !a.renuevaSola);
    if (sinRenovar.some((a) => a.escalon === 30)) return "critical";
    if (sinRenovar.length > 0) return "warning";
    return "info";
}

/**
 * El texto de respaldo, en castellano: es lo que llega por email, Slack o
 * Teams, que no pasan por next-intl. La campanita usa sus claves traducidas.
 */
export function textoDelAviso(avisos: AvisoDeVencimiento[]): { title: string; message: string } {
    const n = avisos.length;
    const title = `📅 ${n} ${n === 1 ? "reserva de Azure vence" : "reservas de Azure vencen"} en los próximos ${avisos[avisos.length - 1].escalon} días`;
    const lineas = avisos.slice(0, 15).map((a) => {
        const cuando = a.dias === 0 ? "vence hoy" : `vence el ${a.vence} (en ${a.dias} ${a.dias === 1 ? "día" : "días"})`;
        return `• ${a.nombre} — ${cuando} · ${a.renuevaSola ? "se renueva sola" : "SIN renovación automática"}`;
    });
    if (n > 15) lineas.push(`… y ${n - 15} más.`);
    lineas.push("", "Si no se renuevan, el consumo que cubren pasa a precio de lista el día del vencimiento.");
    return { title, message: lineas.join("\n") };
}
