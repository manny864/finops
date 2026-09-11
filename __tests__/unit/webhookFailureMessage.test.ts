// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * El sintoma reportado fue "Teams webhook returned 405: Method Not Allowed" —
 * un codigo y nada mas. El cuerpo de la respuesta, que es donde Microsoft
 * explica el motivo, se descartaba; y el caso mas probable (conector clasico
 * de Office 365 retirado) no tiene arreglo del lado nuestro, asi que sin
 * decirlo el admin queda buscando un bug que no existe.
 */
vi.mock("@/lib/webhookSecurity", () => ({
    assertSafeWebhookUrl: vi.fn(async (u: string) => new URL(u)),
}));
vi.mock("@/modules/storage/db", () => ({ default: { query: vi.fn(async () => [[]]) } }));

const { deliverToChannel } = await import("@/lib/notifications");

const canalTeams = (url: string) => ({
    id: 1, type: "teams", name: "Teams", config_json: JSON.stringify({ webhook_url: url }),
});
const payload = { title: "t", message: "m", severity: "info" as const };

function respuesta(status: number, statusText: string, body: string) {
    return {
        ok: false, status, statusText,
        text: async () => body,
    } as Response;
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("mensaje de fallo del webhook", () => {
    it("explica el conector retirado ante un 4xx de webhook.office.com", async () => {
        vi.spyOn(global, "fetch").mockResolvedValue(
            respuesta(405, "Method Not Allowed", "")
        );

        const out = await deliverToChannel(
            "t1", canalTeams("https://cscloud.webhook.office.com/webhookb2/a/IncomingWebhook/b/c"), payload
        );

        expect(out.success).toBe(false);
        expect(out.error).toContain("405");
        expect(out.error).toMatch(/Workflows|Power Automate/);
    });

    it("no da esa pista cuando el host no es el conector clasico", async () => {
        vi.spyOn(global, "fetch").mockResolvedValue(
            respuesta(400, "Bad Request", "Invalid card payload")
        );

        const out = await deliverToChannel(
            "t1", canalTeams("https://prod-5.westus.logic.azure.com/workflows/x/triggers/manual/paths/invoke?sig=y"), payload
        );

        expect(out.success).toBe(false);
        expect(out.error).not.toMatch(/Workflows \(Power Automate\)/);
        // El cuerpo del proveedor sigue siendo lo mas util para diagnosticar.
        expect(out.error).toContain("Invalid card payload");
    });

    it("tampoco la da ante un 5xx del conector clasico: eso es caida, no retiro", async () => {
        vi.spyOn(global, "fetch").mockResolvedValue(respuesta(503, "Service Unavailable", ""));

        const out = await deliverToChannel(
            "t1", canalTeams("https://cscloud.webhook.office.com/webhookb2/a/IncomingWebhook/b/c"), payload
        );

        expect(out.error).toContain("503");
        expect(out.error).not.toMatch(/Workflows/);
    });
});
