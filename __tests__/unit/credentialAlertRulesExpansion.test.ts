/**
 * Las reglas del panel de credenciales se guardan expandidas en `AlertRules`,
 * que es la tabla que lee el cron. Una regla de la UI (varios umbrales, varios
 * canales, varios destinatarios) se convierte en N filas y se reagrupa al leer.
 * Si esa ida y vuelta pierde algo, el usuario ve una regla distinta de la que
 * guardó — o peor, el cron avisa a un destinatario que no corresponde.
 */
import { describe, it, expect } from "vitest";
import {
    MAX_ALERT_ROWS,
    expandAlertRule,
    groupAlertRules,
    targetsFor,
} from "@/services/azureCredentialsExpiry.service";

describe("expansión de reglas de alerta de credenciales", () => {
    it("multiplica umbrales por canales por destinatarios válidos", () => {
        const filas = expandAlertRule({
            warningThresholdsDays: [30, 7],
            notificationChannels: ["EMAIL", "SLACK"],
            recipients: ["ops@empresa.com", "https://hooks.slack.com/x"],
        });
        // 2 umbrales x (1 email + 1 webhook) = 4
        expect(filas).toHaveLength(4);
        expect(filas.filter((f) => f.channel === "email").every((f) => f.target.includes("@"))).toBe(true);
        expect(filas.filter((f) => f.channel === "slack").every((f) => f.target.startsWith("https://"))).toBe(true);
    });

    it("no manda el correo a una URL de webhook ni el webhook a un mail", () => {
        expect(targetsFor("EMAIL", ["a@b.com", "https://hooks.slack.com/x"])).toEqual(["a@b.com"]);
        expect(targetsFor("SLACK", ["a@b.com", "https://hooks.slack.com/x"])).toEqual(["https://hooks.slack.com/x"]);
    });

    it("devuelve vacío cuando ningún destinatario sirve para el canal elegido", () => {
        expect(
            expandAlertRule({
                warningThresholdsDays: [30],
                notificationChannels: ["WEBHOOK"],
                recipients: ["solo-un-mail@empresa.com"],
            })
        ).toEqual([]);
    });

    it("corta en MAX_ALERT_ROWS para que una lista larga no genere cientos de filas", () => {
        const filas = expandAlertRule({
            warningThresholdsDays: [90, 60, 30, 7],
            notificationChannels: ["EMAIL"],
            recipients: Array.from({ length: 30 }, (_, i) => `u${i}@empresa.com`),
        });
        expect(filas).toHaveLength(MAX_ALERT_ROWS);
    });

    it("reagrupa por nombre y reconstruye la regla que se guardó", () => {
        const reglas = groupAlertRules([
            { id: 11, rule_name: "Identidades prod", threshold_value: 30, channel: "email", channel_target: "ops@e.com", reminder_frequency_hours: 24, enabled: 0, last_triggered_at: null },
            { id: 12, rule_name: "Identidades prod", threshold_value: 7, channel: "email", channel_target: "ops@e.com", reminder_frequency_hours: 24, enabled: 1, last_triggered_at: "2026-09-01T10:00:00Z" },
            { id: 13, rule_name: "Identidades prod", threshold_value: 7, channel: "slack", channel_target: "https://h/x", reminder_frequency_hours: 24, enabled: 1, last_triggered_at: "2026-09-03T10:00:00Z" },
            { id: 20, rule_name: "Otra", threshold_value: 90, channel: "email", channel_target: "cfo@e.com", reminder_frequency_hours: null, enabled: 1, last_triggered_at: null },
        ]);
        expect(reglas).toHaveLength(2);
        const prod = reglas.find((r) => r.ruleName === "Identidades prod")!;
        expect(prod.warningThresholdsDays).toEqual([30, 7]);
        expect(prod.notificationChannels).toEqual(["EMAIL", "SLACK"]);
        expect(prod.recipients).toEqual(["ops@e.com", "https://h/x"]);
        // Basta una fila activa para que la regla cuente como activa.
        expect(prod.isEnabled).toBe(true);
        // El último aviso es el más reciente del grupo, no el de la primera fila.
        expect(prod.lastTriggeredAt).toBe("2026-09-03T10:00:00.000Z");
        expect(prod.id).toBe("Identidades prod");
        expect(reglas.find((r) => r.ruleName === "Otra")!.reminderFrequencyHours).toBeNull();
    });

    it("acepta el DECIMAL que mysql2 devuelve como string", () => {
        // `threshold_value` es DECIMAL(14,4) y el driver lo entrega como
        // "30.0000", no como 30. Verificado contra la base: un Number() de
        // menos y los umbrales salen NaN en la tabla del panel.
        const [regla] = groupAlertRules([
            { id: 3, rule_name: "Credenciales por vencer (≤ 30 días)", threshold_value: "30.0000", channel: "email", channel_target: "a@b.com", reminder_frequency_hours: 24, enabled: 1, last_triggered_at: null },
        ]);
        expect(regla.warningThresholdsDays).toEqual([30]);
    });

    it("una regla con todas sus filas deshabilitadas no figura como activa", () => {
        const [regla] = groupAlertRules([
            { id: 1, rule_name: "X", threshold_value: 30, channel: "email", channel_target: "a@b.com", reminder_frequency_hours: 24, enabled: 0, last_triggered_at: null },
        ]);
        expect(regla.isEnabled).toBe(false);
    });
});
