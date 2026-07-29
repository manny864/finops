import { describe, it, expect } from "vitest";
import {
    offsetMinutesFor,
    formatOffset,
    parseOffsetMinutes,
    effectiveOffsetMinutes,
    isValidTimeZone,
    normalizeTimeZone,
    localDateString,
    formatInTimeZone,
    DEFAULT_TIMEZONE,
} from "@/lib/timezone";

// Dos instantes fijos a ambos lados del horario de verano del hemisferio norte.
const JULIO = new Date("2026-07-15T12:00:00Z");
const ENERO = new Date("2026-01-15T12:00:00Z");

describe("offsetMinutesFor", () => {
    it("Argentina no tiene DST: mismo offset todo el año", () => {
        expect(formatOffset(offsetMinutesFor("America/Argentina/Buenos_Aires", JULIO))).toBe("-03:00");
        expect(formatOffset(offsetMinutesFor("America/Argentina/Buenos_Aires", ENERO))).toBe("-03:00");
    });

    // Este es el bug que motivó la migración de gmt_offset a IANA: un horario
    // guardado en julio con offset fijo +02:00 apagaba las VMs una hora antes
    // desde noviembre.
    it("Madrid cambia con el horario de verano", () => {
        expect(formatOffset(offsetMinutesFor("Europe/Madrid", JULIO))).toBe("+02:00");
        expect(formatOffset(offsetMinutesFor("Europe/Madrid", ENERO))).toBe("+01:00");
    });

    it("Nueva York cambia con el horario de verano", () => {
        expect(formatOffset(offsetMinutesFor("America/New_York", JULIO))).toBe("-04:00");
        expect(formatOffset(offsetMinutesFor("America/New_York", ENERO))).toBe("-05:00");
    });

    it("soporta offsets de media hora", () => {
        expect(formatOffset(offsetMinutesFor("Asia/Kolkata", JULIO))).toBe("+05:30");
    });
});

describe("effectiveOffsetMinutes", () => {
    it("la zona IANA gana sobre el offset fijo guardado", () => {
        expect(formatOffset(effectiveOffsetMinutes("Europe/Madrid", "+01:00", JULIO))).toBe("+02:00");
    });

    it("sin zona, respeta el offset fijo de las filas viejas", () => {
        expect(formatOffset(effectiveOffsetMinutes(null, "+01:00", JULIO))).toBe("+01:00");
    });

    it("una zona inválida no rompe: cae al offset guardado", () => {
        expect(formatOffset(effectiveOffsetMinutes("Marte/Olympus", "-05:00", JULIO))).toBe("-05:00");
    });
});

describe("parseOffsetMinutes", () => {
    it("interpreta el formato de PowerSchedules.gmt_offset", () => {
        expect(parseOffsetMinutes("-03:00")).toBe(-180);
        expect(parseOffsetMinutes("+05:30")).toBe(330);
        expect(parseOffsetMinutes("+00:00")).toBe(0);
    });

    it("devuelve 0 ante basura en vez de NaN", () => {
        expect(parseOffsetMinutes("no-es-un-offset")).toBe(0);
    });
});

describe("validación de zona", () => {
    it("acepta nombres IANA y rechaza el resto", () => {
        expect(isValidTimeZone("Europe/Madrid")).toBe(true);
        expect(isValidTimeZone("nope/nope")).toBe(false);
        expect(isValidTimeZone("")).toBe(false);
        expect(isValidTimeZone(null)).toBe(false);
    });

    it("normalizeTimeZone cae al default", () => {
        expect(normalizeTimeZone("nope/nope")).toBe(DEFAULT_TIMEZONE);
        expect(normalizeTimeZone("Europe/Madrid")).toBe("Europe/Madrid");
    });
});

describe("localDateString", () => {
    // Decide "¿ya corrió hoy?" sin depender de en qué zona corre el proceso.
    it("el día local puede diferir del día UTC", () => {
        const justoDespuesDeMedianocheUtc = new Date("2026-07-16T01:30:00Z");
        expect(localDateString("America/Argentina/Buenos_Aires", justoDespuesDeMedianocheUtc)).toBe("2026-07-15");
        expect(localDateString("UTC", justoDespuesDeMedianocheUtc)).toBe("2026-07-16");
    });
});

describe("formatInTimeZone", () => {
    it("el mismo instante se lee distinto en cada zona", () => {
        const instante = new Date("2026-07-15T23:30:00Z");
        const ba = formatInTimeZone(instante, "America/Argentina/Buenos_Aires", "es-AR");
        const madrid = formatInTimeZone(instante, "Europe/Madrid", "es-AR");
        expect(ba).not.toBe(madrid);
        expect(ba).toContain("15/7");   // 20:30 del 15 en Buenos Aires
        expect(madrid).toContain("16/7"); // 01:30 del 16 en Madrid
    });

    it("no explota con valores vacíos o inválidos", () => {
        expect(formatInTimeZone(null, "UTC")).toBe("");
        expect(formatInTimeZone("", "UTC")).toBe("");
        expect(formatInTimeZone("no-es-fecha", "UTC")).toBe("");
    });
});
