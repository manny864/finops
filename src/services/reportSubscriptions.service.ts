/**
 * MEJ-35 — cuándo corresponde mandar una suscripción.
 *
 * Todo lo de este archivo es puro. La decisión "¿esta suscripción vence en esta
 * corrida?" es la mejora entera: si se equivoca de más, el cliente recibe el
 * mismo reporte veinticuatro veces en un día; si se equivoca de menos, deja de
 * llegar y nadie se entera, que es peor.
 *
 * UN SOLO CRON EVALUADOR para todas las suscripciones, y no uno por tipo de
 * reporte: ya hay 26 jobs y sumar uno por reporte no escala.
 */

export type Frecuencia = "daily" | "weekly" | "monthly";

export interface Suscripcion {
    id: number;
    frequency: Frecuencia;
    /** 0=domingo .. 6=sábado, igual que `Date.getDay()`. */
    dayOfWeek: number | null;
    /** 1..31. Se recorta al último día del mes cuando no existe. */
    dayOfMonth: number | null;
    lastSentAt: Date | null;
}

/** Las partes de una fecha EN LA ZONA DEL TENANT, no en la del servidor. */
export interface FechaLocal {
    anio: number;
    mes: number;      // 1..12
    dia: number;      // 1..31
    diaSemana: number; // 0..6
}

/**
 * Descompone un instante en la zona del tenant.
 *
 * Se usa `Intl` y no aritmética de offsets a propósito: un offset fijo se
 * rompe dos veces por año con el horario de verano, y "los lunes" pasaría a
 * caer domingo a la noche para medio mundo. Es el mismo motivo por el que
 * `Tenants.timezone` existe — ver la zona horaria de Power Schedules.
 */
export function enZona(instante: Date, zona: string): FechaLocal {
    const f = new Intl.DateTimeFormat("en-CA", {
        timeZone: zona,
        year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    });
    const partes = Object.fromEntries(f.formatToParts(instante).map((p) => [p.type, p.value]));
    const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
        anio: Number(partes.year),
        mes: Number(partes.month),
        dia: Number(partes.day),
        diaSemana: dias[String(partes.weekday)] ?? 0,
    };
}

/** Cuántos días tiene ese mes. */
export function diasDelMes(anio: number, mes: number): number {
    return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/**
 * El día del mes en el que ESTE mes corresponde mandar.
 *
 * Un `day_of_month` de 31 en febrero no se saltea el mes: se recorta al 28 (o
 * 29). Si no, una suscripción "el 31" no llegaría nunca en los meses cortos y
 * el usuario no tendría cómo darse cuenta — la ausencia de un correo no avisa.
 */
export function diaEfectivoDelMes(diaPedido: number, anio: number, mes: number): number {
    return Math.min(Math.max(1, diaPedido), diasDelMes(anio, mes));
}

/**
 * El comienzo del período vigente, o `null` si hoy no toca.
 *
 * Devuelve la fecha local como `YYYY-MM-DD` en vez de un `Date`: es la clave
 * contra la que se compara `last_sent_at`, y compararla como texto evita
 * arrastrar la zona del servidor a la decisión.
 */
export function inicioDelPeriodo(sub: Suscripcion, hoy: FechaLocal): string | null {
    const ymd = (a: number, m: number, d: number) =>
        `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

    if (sub.frequency === "daily") return ymd(hoy.anio, hoy.mes, hoy.dia);

    if (sub.frequency === "weekly") {
        if (sub.dayOfWeek === null) return null;
        return hoy.diaSemana === sub.dayOfWeek ? ymd(hoy.anio, hoy.mes, hoy.dia) : null;
    }

    if (sub.dayOfMonth === null) return null;
    const efectivo = diaEfectivoDelMes(sub.dayOfMonth, hoy.anio, hoy.mes);
    return hoy.dia === efectivo ? ymd(hoy.anio, hoy.mes, hoy.dia) : null;
}

export interface Decision {
    debe: boolean;
    /** El período que se estaría cubriendo, para guardarlo y para el log. */
    periodo: string | null;
    motivo: "toca" | "hoy-no-toca" | "ya-se-mando";
}

/**
 * ¿Hay que mandar esta suscripción ahora?
 *
 * LA REGLA: se manda si hoy es el día Y no se mandó todavía dentro de este
 * período. `last_sent_at` se compara contra el COMIENZO del período, no contra
 * "hace 7 días": con una ventana móvil, una corrida que se atrasa una hora
 * correría el horario de todas las siguientes hasta desalinearse del día.
 */
export function correspondeEnviar(sub: Suscripcion, ahora: Date, zona: string): Decision {
    const hoy = enZona(ahora, zona);
    const periodo = inicioDelPeriodo(sub, hoy);
    if (!periodo) return { debe: false, periodo: null, motivo: "hoy-no-toca" };

    if (sub.lastSentAt) {
        // `last_sent_at` se guarda en UTC; se lo mira en la zona del tenant para
        // que "ya se mandó hoy" signifique el día del tenant y no el del servidor.
        const ultimo = enZona(sub.lastSentAt, zona);
        const ultimoYmd = `${ultimo.anio}-${String(ultimo.mes).padStart(2, "0")}-${String(ultimo.dia).padStart(2, "0")}`;
        if (ultimoYmd >= periodo) return { debe: false, periodo, motivo: "ya-se-mando" };
    }
    return { debe: true, periodo, motivo: "toca" };
}
