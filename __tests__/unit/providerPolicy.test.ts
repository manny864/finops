import { describe, it, expect } from "vitest";
import {
    autoElectRetainedProvider,
    canIngestProvider,
    canReadProvider,
    computePurgeDate,
    DEFAULT_ARCHIVE_RETENTION_DAYS,
    daysUntil,
    getArchiveRetentionDays,
    normalizeProviderSetting,
    otherProvider,
    pendingReminderMilestone,
    reconcileProviderOnTierChange,
    tierAllowsMultiProvider,
} from "@/lib/providerPolicy";

describe("providerPolicy — exclusividad por tier", () => {
    it("solo Enterprise puede tener los dos proveedores", () => {
        expect(tierAllowsMultiProvider("Enterprise")).toBe(true);
        expect(tierAllowsMultiProvider("Business")).toBe(false);
        expect(tierAllowsMultiProvider("Professional")).toBe(false);
        expect(tierAllowsMultiProvider("Essential")).toBe(false);
    });

    it("un tier desconocido o vacío falla cerrado", () => {
        expect(tierAllowsMultiProvider("Platinum")).toBe(false);
        expect(tierAllowsMultiProvider("")).toBe(false);
        expect(tierAllowsMultiProvider(null)).toBe(false);
    });

    it("normaliza un provider corrupto a 'azure' (fail-safe, no habilita AWS)", () => {
        expect(normalizeProviderSetting("aws")).toBe("aws");
        expect(normalizeProviderSetting("both")).toBe("both");
        expect(normalizeProviderSetting("gcp")).toBe("azure");
        expect(normalizeProviderSetting(undefined)).toBe("azure");
    });
});

describe("providerPolicy — reconciliación al cambiar de tier", () => {
    it("bajar de Enterprise con 'both' archiva un proveedor", () => {
        expect(
            reconcileProviderOnTierChange({
                previousTier: "Enterprise",
                nextTier: "Business",
                currentProvider: "both",
                archivedProvider: null,
            })
        ).toEqual({ action: "archive" });
    });

    it("bajar de Enterprise con un solo proveedor no toca nada", () => {
        expect(
            reconcileProviderOnTierChange({
                previousTier: "Enterprise",
                nextTier: "Essential",
                currentProvider: "aws",
                archivedProvider: null,
            })
        ).toEqual({ action: "none" });
    });

    it("volver a Enterprise durante la gracia restaura el archivado", () => {
        expect(
            reconcileProviderOnTierChange({
                previousTier: "Business",
                nextTier: "Enterprise",
                currentProvider: "azure",
                archivedProvider: "aws",
            })
        ).toEqual({ action: "restore", provider: "aws" });
    });

    it("subir a Enterprise sin nada archivado no dispara restauración", () => {
        expect(
            reconcileProviderOnTierChange({
                previousTier: "Business",
                nextTier: "Enterprise",
                currentProvider: "azure",
                archivedProvider: null,
            })
        ).toEqual({ action: "none" });
    });

    it("es idempotente: reprocesar el webhook del downgrade no vuelve a archivar", () => {
        // Tras el primer archivado el tenant ya no es 'both'.
        expect(
            reconcileProviderOnTierChange({
                previousTier: "Enterprise",
                nextTier: "Business",
                currentProvider: "azure",
                archivedProvider: "aws",
            })
        ).toEqual({ action: "none" });
    });
});

describe("providerPolicy — elección automática del proveedor retenido", () => {
    const footprint = (azure: string, aws: string, azureAcc = 1, awsAcc = 1) => ({
        spend: { azure, aws },
        connectedAccounts: { azure: azureAcc, aws: awsAcc },
    });

    it("retiene el proveedor con más gasto", () => {
        expect(autoElectRetainedProvider(footprint("1000.00", "250.00"))).toBe("azure");
        expect(autoElectRetainedProvider(footprint("250.00", "1000.00"))).toBe("aws");
    });

    it("compara con precisión decimal, no con float (Regla Cero)", () => {
        // 0.1 + 0.2 !== 0.3 en float. Acá la diferencia es de 1 centavo y
        // define qué dataset se borra: no puede resolverse por error de coma.
        expect(autoElectRetainedProvider(footprint("0.30", "0.30000001"))).toBe("aws");
        expect(autoElectRetainedProvider(footprint("10000000000.02", "10000000000.01"))).toBe("azure");
    });

    it("con gasto empatado desempata por cuentas conectadas", () => {
        expect(autoElectRetainedProvider(footprint("500.00", "500.00", 1, 4))).toBe("aws");
        expect(autoElectRetainedProvider(footprint("500.00", "500.00", 4, 1))).toBe("azure");
    });

    it("con todo empatado cae a 'azure' (default histórico)", () => {
        expect(autoElectRetainedProvider(footprint("0", "0", 0, 0))).toBe("azure");
        expect(autoElectRetainedProvider(footprint("500.00", "500.00", 2, 2))).toBe("azure");
    });

    it("otherProvider devuelve el complemento", () => {
        expect(otherProvider("aws")).toBe("azure");
        expect(otherProvider("azure")).toBe("aws");
    });
});

describe("providerPolicy — ventana de gracia", () => {
    it("usa 90 días por defecto", () => {
        expect(getArchiveRetentionDays(undefined)).toBe(DEFAULT_ARCHIVE_RETENTION_DAYS);
        expect(getArchiveRetentionDays("")).toBe(DEFAULT_ARCHIVE_RETENTION_DAYS);
        expect(getArchiveRetentionDays("no-es-un-numero")).toBe(DEFAULT_ARCHIVE_RETENTION_DAYS);
    });

    it("clampea valores peligrosos en vez de aceptarlos", () => {
        // Una env mal escrita no puede hacer que el sistema purgue mañana...
        expect(getArchiveRetentionDays("1")).toBe(7);
        expect(getArchiveRetentionDays("-30")).toBe(DEFAULT_ARCHIVE_RETENTION_DAYS);
        // ...ni que retenga para siempre.
        expect(getArchiveRetentionDays("99999")).toBe(730);
        expect(getArchiveRetentionDays(120)).toBe(120);
    });

    it("calcula la fecha de purga sumando días UTC", () => {
        const archivedAt = new Date("2026-01-15T10:00:00.000Z");
        expect(computePurgeDate(archivedAt, 90).toISOString()).toBe("2026-04-15T10:00:00.000Z");
    });

    it("daysUntil no se rompe cruzando fin de mes", () => {
        expect(daysUntil(new Date("2026-03-01T00:00:00Z"), new Date("2026-02-27T00:00:00Z"))).toBe(2);
    });
});

describe("providerPolicy — recordatorios previos a la purga", () => {
    const purgeAt = new Date("2026-04-15T00:00:00.000Z");

    it("no avisa cuando falta mucho", () => {
        expect(pendingReminderMilestone(purgeAt, new Date("2026-02-01T00:00:00Z"), [])).toBeNull();
    });

    it("avisa a los 30 días", () => {
        expect(pendingReminderMilestone(purgeAt, new Date("2026-03-16T00:00:00Z"), [])).toBe(30);
    });

    it("no repite un aviso ya enviado (idempotencia del cron diario)", () => {
        expect(pendingReminderMilestone(purgeAt, new Date("2026-03-20T00:00:00Z"), [30])).toBeNull();
    });

    it("avisa a los 7 días aunque el de 30 ya se haya mandado", () => {
        expect(pendingReminderMilestone(purgeAt, new Date("2026-04-10T00:00:00Z"), [30])).toBe(7);
    });

    it("no vuelve a avisar con los dos hitos cubiertos", () => {
        expect(pendingReminderMilestone(purgeAt, new Date("2026-04-14T00:00:00Z"), [30, 7])).toBeNull();
    });
});

describe("providerPolicy — permisos de ingesta vs lectura del archivado", () => {
    it("el proveedor archivado NO se puede ingerir", () => {
        expect(canIngestProvider("azure", "aws", "aws")).toBe(false);
        expect(canIngestProvider("azure", "aws", "azure")).toBe(true);
    });

    it("el proveedor archivado SÍ se puede leer/exportar durante la gracia", () => {
        // Portabilidad: bajar de plan no puede secuestrar los datos.
        expect(canReadProvider("azure", "aws", "aws")).toBe(true);
        expect(canReadProvider("azure", "aws", "azure")).toBe(true);
    });

    it("un proveedor que el tenant nunca tuvo no se lee ni se ingiere", () => {
        expect(canIngestProvider("azure", null, "aws")).toBe(false);
        expect(canReadProvider("azure", null, "aws")).toBe(false);
    });

    it("un tenant 'both' puede todo", () => {
        expect(canIngestProvider("both", null, "aws")).toBe(true);
        expect(canIngestProvider("both", null, "azure")).toBe(true);
        expect(canReadProvider("both", null, "aws")).toBe(true);
    });
});
