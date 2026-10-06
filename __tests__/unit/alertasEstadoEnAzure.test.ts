// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * cambiarEstadoEnAzure: el switch de alertas y action groups escribe en la
 * Azure del cliente (hasta el 2026-10-06 respondía "éxito" sin tocar nada).
 * Fija los contratos verificados (api-version y cuerpo por tipo) y el borde
 * entre tenants: con Lighthouse la credencial alcanza a todos los clientes.
 */

const { fetchMock, logMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), logMock: vi.fn(async () => {}) }));

vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn(async () => ({ getToken: async () => ({ token: "tok" }) })),
    getSubscriptionsForTenant: vi.fn(async () => ["SUB-1"]),
    getResourceGraphClient: vi.fn(),
}));
vi.mock("@/lib/azureSubscriptionNames", () => ({ getSubscriptionNameMap: vi.fn(), resolveSubscriptionName: vi.fn() }));
vi.mock("@/lib/argConcurrency", () => ({ withArgLimit: vi.fn() }));
vi.mock("@/services/remediationService", () => ({ logAction: logMock }));
vi.stubGlobal("fetch", fetchMock);

import { cambiarEstadoEnAzure } from "@/services/azureAlertsRules.service";

const rg = "/subscriptions/sub-1/resourceGroups/rg";
const ok = () => fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));

describe("cambiarEstadoEnAzure", () => {
    beforeEach(() => {
        fetchMock.mockReset();
        logMock.mockClear();
    });

    it("smart detector: PATCH con state y el nombre con espacios codificado", async () => {
        ok();
        await cambiarEstadoEnAzure("t1", `${rg}/providers/microsoft.alertsmanagement/smartDetectorAlertRules/Failure Anomalies - appi`, false, "alertas", "a@b.c");
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`https://management.azure.com${rg}/providers/microsoft.alertsmanagement/smartDetectorAlertRules/Failure%20Anomalies%20-%20appi?api-version=2021-04-01`);
        expect(init.method).toBe("PATCH");
        expect(JSON.parse(init.body)).toEqual({ properties: { state: "Disabled" } });
        expect(logMock).toHaveBeenCalledWith("t1", "a@b.c", "TOGGLE_ALERT_RULE", expect.any(String), "SUCCESS");
    });

    it("metric alert y action group: enabled booleano con su api-version", async () => {
        ok();
        await cambiarEstadoEnAzure("t1", `${rg}/providers/Microsoft.Insights/metricalerts/cpu`, true, "alertas", "a@b.c");
        expect(fetchMock.mock.calls[0][0]).toContain("api-version=2024-03-01-preview");
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ properties: { enabled: true } });
        ok();
        await cambiarEstadoEnAzure("t1", `${rg}/providers/Microsoft.Insights/actiongroups/ag`, false, "actionGroups", "a@b.c");
        expect(fetchMock.mock.calls[1][0]).toContain("api-version=2021-09-01");
    });

    it("una suscripción de otro tenant no llega a Azure", async () => {
        await expect(
            cambiarEstadoEnAzure("t1", "/subscriptions/sub-OTRO/resourceGroups/rg/providers/Microsoft.Insights/metricalerts/x", false, "alertas", "a@b.c")
        ).rejects.toMatchObject({ status: 404 });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("cada ruta sólo toca su familia, y los web tests se derivan al portal", async () => {
        await expect(cambiarEstadoEnAzure("t1", `${rg}/providers/Microsoft.Insights/actiongroups/ag`, false, "alertas", "x")).rejects.toMatchObject({ status: 400 });
        await expect(cambiarEstadoEnAzure("t1", `${rg}/providers/Microsoft.Insights/metricalerts/m`, false, "actionGroups", "x")).rejects.toMatchObject({ status: 400 });
        await expect(cambiarEstadoEnAzure("t1", `${rg}/providers/Microsoft.Compute/virtualMachines/vm`, false, "alertas", "x")).rejects.toMatchObject({ status: 400 });
        await expect(cambiarEstadoEnAzure("t1", `${rg}/providers/Microsoft.Insights/webtests/w`, false, "alertas", "x")).rejects.toMatchObject({ status: 422 });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("el 403 de Azure sube con su status y código, y queda auditado como FAILED", async () => {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "AuthorizationFailed", message: "no" } }), { status: 403 }));
        await expect(
            cambiarEstadoEnAzure("t1", `${rg}/providers/Microsoft.Insights/activityLogAlerts/a`, false, "alertas", "a@b.c")
        ).rejects.toMatchObject({ status: 403, code: "AuthorizationFailed" });
        expect(logMock).toHaveBeenCalledWith("t1", "a@b.c", "TOGGLE_ALERT_RULE", expect.any(String), "FAILED");
    });
});
