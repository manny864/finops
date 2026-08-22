import { describe, it, expect } from "vitest";
import {
    deriveIngestionStatus,
    INGESTION_STALE_HOURS,
    normalizePlanTier,
} from "@/types/tenantAccountStatus.types";

const NOW = new Date("2026-08-22T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 36e5);

describe("deriveIngestionStatus", () => {
    // El panel viejo mostraba "Sincronización OK" con un tilde verde como
    // literal, así que afirmaba que todo estaba bien incluso con la ingesta
    // caída. Cada estado tiene que salir de los datos.
    it("HEALTHY con una sincronización reciente", () => {
        expect(deriveIngestionStatus({ syncStatus: "ok", lastSyncAt: hoursAgo(1), hasError: false, now: NOW })).toBe("HEALTHY");
    });

    it("DEGRADED cuando la última muestra pasó el umbral", () => {
        expect(deriveIngestionStatus({ syncStatus: "ok", lastSyncAt: hoursAgo(INGESTION_STALE_HOURS + 1), hasError: false, now: NOW })).toBe("DEGRADED");
        // Justo en el umbral todavía es sano: el cron diario puede correrse un poco.
        expect(deriveIngestionStatus({ syncStatus: "ok", lastSyncAt: hoursAgo(INGESTION_STALE_HOURS - 1), hasError: false, now: NOW })).toBe("HEALTHY");
    });

    it("DISCONNECTED si nunca sincronizó", () => {
        expect(deriveIngestionStatus({ syncStatus: null, lastSyncAt: null, hasError: false, now: NOW })).toBe("DISCONNECTED");
    });

    it("DISCONNECTED si el último intento dejó un error, aunque sea reciente", () => {
        expect(deriveIngestionStatus({ syncStatus: "ok", lastSyncAt: hoursAgo(1), hasError: true, now: NOW })).toBe("DISCONNECTED");
        expect(deriveIngestionStatus({ syncStatus: "error", lastSyncAt: hoursAgo(1), hasError: false, now: NOW })).toBe("DISCONNECTED");
    });

    it("SYNCING mientras el job corre, sin importar la antigüedad", () => {
        expect(deriveIngestionStatus({ syncStatus: "syncing", lastSyncAt: hoursAgo(200), hasError: false, now: NOW })).toBe("SYNCING");
        expect(deriveIngestionStatus({ syncStatus: "running", lastSyncAt: null, hasError: false, now: NOW })).toBe("SYNCING");
    });

    it("DISCONNECTED ante una fecha inválida en vez de reportar salud", () => {
        expect(deriveIngestionStatus({ syncStatus: "ok", lastSyncAt: "no-es-fecha", hasError: false, now: NOW })).toBe("DISCONNECTED");
    });

    it("acepta la fecha como string ISO", () => {
        expect(deriveIngestionStatus({ syncStatus: "ok", lastSyncAt: hoursAgo(2).toISOString(), hasError: false, now: NOW })).toBe("HEALTHY");
    });
});

describe("normalizePlanTier", () => {
    it("mapea los tiers de la plataforma", () => {
        expect(normalizePlanTier("Enterprise")).toBe("Enterprise");
        expect(normalizePlanTier("business")).toBe("Professional");
        expect(normalizePlanTier("Professional")).toBe("Professional");
    });

    it("cae a Community ante un valor desconocido o vacío", () => {
        expect(normalizePlanTier(null)).toBe("Community");
        expect(normalizePlanTier("")).toBe("Community");
        expect(normalizePlanTier("gratis")).toBe("Community");
    });
});
