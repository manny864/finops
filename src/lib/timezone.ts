/**
 * Zonas horarias por tenant.
 *
 * Todo lo que se guarda es un nombre IANA (`America/Argentina/Buenos_Aires`),
 * nunca un offset fijo. Un offset no identifica una zona (`-03:00` es Buenos
 * Aires, Montevideo, Santiago o São Paulo) y, sobre todo, no sabe de horario
 * de verano: un offset guardado en julio en Madrid (+02:00) queda una hora
 * corrido a partir de noviembre.
 *
 * Sin dependencias nuevas: `Intl` ya trae la base de datos de zonas.
 */

export const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

/** Zona horaria del scheduler de infraestructura (los cron jobs de Azure). */
export const SCHEDULER_TIMEZONE = DEFAULT_TIMEZONE;

export function isValidTimeZone(tz: string | null | undefined): boolean {
    if (!tz || typeof tz !== "string") return false;
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

/** Devuelve `tz` si es una zona IANA válida; si no, el default. */
export function normalizeTimeZone(tz: string | null | undefined): string {
    return isValidTimeZone(tz) ? (tz as string) : DEFAULT_TIMEZONE;
}

/**
 * Minutos que la zona `tz` está adelantada respecto de UTC **en el instante
 * `at`** — que es la parte que importa: contempla el DST vigente en esa fecha,
 * no el de hoy.
 *
 * Buenos Aires → -180 siempre. Madrid → +60 en invierno, +120 en verano.
 */
export function offsetMinutesFor(tz: string, at: Date = new Date()): number {
    const zone = normalizeTimeZone(tz);
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).formatToParts(at);

    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    // `hour` puede venir como 24 en algunos runtimes cuando es medianoche.
    const asIfUtc = Date.UTC(
        get("year"),
        get("month") - 1,
        get("day"),
        get("hour") % 24,
        get("minute"),
        get("second")
    );
    return Math.round((asIfUtc - at.getTime()) / 60000);
}

/** Minutos → "+HH:MM" / "-HH:MM", el formato de PowerSchedules.gmt_offset. */
export function formatOffset(minutes: number): string {
    const sign = minutes < 0 ? "-" : "+";
    const abs = Math.abs(minutes);
    const hh = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm = String(abs % 60).padStart(2, "0");
    return `${sign}${hh}:${mm}`;
}

/** "+HH:MM" → minutos. Convive con las filas viejas que sólo tienen offset. */
export function parseOffsetMinutes(offset: string): number {
    const m = /^([+-])(\d{2}):(\d{2})$/.exec(String(offset).trim());
    if (!m) return 0;
    const sign = m[1] === "-" ? -1 : 1;
    return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

/**
 * Offset efectivo de un registro que puede tener zona IANA (nuevo) u offset
 * fijo (viejo). La zona gana: es la única que contempla DST.
 */
export function effectiveOffsetMinutes(
    timeZone: string | null | undefined,
    gmtOffset: string | null | undefined,
    at: Date = new Date()
): number {
    if (isValidTimeZone(timeZone)) return offsetMinutesFor(timeZone as string, at);
    return parseOffsetMinutes(gmtOffset || "+00:00");
}

/**
 * Formatea una fecha en la zona del tenant. Es el reemplazo de los
 * `new Date(x).toLocaleString()` sueltos, que usaban la zona del navegador (en
 * el cliente) o la del proceso (en el servidor) — dos miembros del mismo
 * equipo en países distintos veían horas distintas para el mismo evento.
 */
export function formatInTimeZone(
    value: Date | string | number | null | undefined,
    timeZone: string,
    locale = "es-AR",
    options: Intl.DateTimeFormatOptions = { dateStyle: "short", timeStyle: "short" }
): string {
    if (value === null || value === undefined || value === "") return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: normalizeTimeZone(timeZone) }).format(date);
}

/** Sólo la fecha, en la zona del tenant. */
export function formatDateInTimeZone(
    value: Date | string | number | null | undefined,
    timeZone: string,
    locale = "es-AR"
): string {
    return formatInTimeZone(value, timeZone, locale, { dateStyle: "short" });
}

/**
 * "YYYY-MM-DD" del instante `at` según la zona `tz`. Sirve para decidir "¿ya
 * corrió hoy?" sin que la respuesta dependa de en qué zona corre el proceso.
 */
export function localDateString(tz: string, at: Date = new Date()): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: normalizeTimeZone(tz),
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(at);
}
