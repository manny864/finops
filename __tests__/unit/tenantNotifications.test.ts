import { describe, it, expect } from "vitest";
import {
    channelTypeFromDb,
    channelTypeToDb,
    maskTargetEndpoint,
    severityFilterFromDb,
    severityFilterToDb,
} from "@/types/tenantNotifications.types";

describe("mapeo de tipo de canal", () => {
    it("va y vuelve contra el ENUM en minúscula que ya usa la tabla", () => {
        expect(channelTypeToDb("SLACK")).toBe("slack");
        expect(channelTypeToDb("WEBHOOK")).toBe("webhook");
        expect(channelTypeFromDb("teams")).toBe("TEAMS");
    });

    it("un tipo desconocido cae a WEBHOOK y no rompe la fila", () => {
        expect(channelTypeFromDb("pagerduty")).toBe("WEBHOOK");
        expect(channelTypeFromDb(null)).toBe("WEBHOOK");
    });
});

describe("filtro de severidad", () => {
    // El dispatcher hace filter.split(',').includes(severity); si el mapeo no
    // produce exactamente esas listas, el canal deja de recibir en silencio.
    it("produce las listas que el dispatcher sabe leer", () => {
        expect(severityFilterToDb("ALL")).toBe("info,warning,error");
        expect(severityFilterToDb("HIGH_AND_ABOVE")).toBe("warning,error");
        expect(severityFilterToDb("CRITICAL_ONLY")).toBe("error");
    });

    it("interpreta el formato heredado de la columna", () => {
        expect(severityFilterFromDb("info,warning,error")).toBe("ALL");
        expect(severityFilterFromDb("warning,error")).toBe("HIGH_AND_ABOVE");
        expect(severityFilterFromDb("error")).toBe("CRITICAL_ONLY");
        // Default de la columna cuando está en NULL.
        expect(severityFilterFromDb(null)).toBe("ALL");
        expect(severityFilterFromDb(" info , warning , error ")).toBe("ALL");
    });

    it("un filtro CRITICAL_ONLY sobrevive el round-trip", () => {
        expect(severityFilterFromDb(severityFilterToDb("CRITICAL_ONLY"))).toBe("CRITICAL_ONLY");
        expect(severityFilterFromDb(severityFilterToDb("HIGH_AND_ABOVE"))).toBe("HIGH_AND_ABOVE");
    });
});

describe("enmascarado del destino", () => {
    // La URL de un webhook de Slack/Teams es un secreto portador: quien la tiene
    // publica en el canal. No puede volver entera al cliente.
    it("no filtra el path del webhook", () => {
        const url = "https://hooks.slack.com/services/T00000000/B11111111/XXXXsecretoXXXX";
        const masked = maskTargetEndpoint("SLACK", { webhookUrl: url });

        expect(masked).not.toContain("XXXXsecretoXXXX");
        expect(masked).not.toContain("T00000000");
        expect(masked).toContain("hooks.slack.com");
    });

    it("distingue dos canales del mismo host por la cola", () => {
        const a = maskTargetEndpoint("SLACK", { webhookUrl: "https://hooks.slack.com/services/A/B/aaaa" });
        const b = maskTargetEndpoint("SLACK", { webhookUrl: "https://hooks.slack.com/services/A/B/bbbb" });
        expect(a).not.toBe(b);
    });

    it("enmascara el usuario del email pero conserva el dominio", () => {
        const masked = maskTargetEndpoint("EMAIL", { to: ["finanzas@empresa.com", "cto@empresa.com"] });
        expect(masked).toContain("@empresa.com");
        expect(masked).not.toContain("finanzas@");
        expect(masked).toContain("+1"); // indica que hay más destinatarios
    });

    it("acepta la lista de correos como string separada por comas", () => {
        const masked = maskTargetEndpoint("EMAIL", { to: "uno@x.com, dos@x.com" });
        expect(masked).toContain("+1");
    });

    it("no explota con config vacía o URL malformada", () => {
        expect(maskTargetEndpoint("WEBHOOK", {})).toBe("—");
        expect(maskTargetEndpoint("EMAIL", {})).toBe("—");
        expect(maskTargetEndpoint("WEBHOOK", { webhookUrl: "no-es-url" })).toBe("•••");
        expect(maskTargetEndpoint("SLACK", null)).toBe("—");
    });
});
