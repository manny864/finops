// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => queryMock(...a) } }));
vi.mock("@/lib/mockData", () => ({ isMockTenant: () => false }));

import { getTenantBillingDetails, cancelTenantSubscription } from "@/services/saasBilling.service";

const TENANT = "54d7cf18-0baa-4da7-8242-fbf59a92aaac";

beforeEach(() => queryMock.mockReset());

describe("el panel de Mi cuenta muestra el tier que el tenant realmente paga", () => {
    // EL BUG: consultaba `TenantSaaSSubscriptions`, que no existe, y el fallback
    // filtraba por `WHERE id = ?` en vez de `tenant_id`. Las dos fallaban, el
    // catch se las tragaba y quedaba el default del inicializador: "Enterprise".
    // Un tenant Professional veia "Tu plan Enterprise incluye suscripciones
    // ilimitadas".
    it("un tenant Professional se muestra como Professional", async () => {
        queryMock
            .mockResolvedValueOnce([[{ tier: "Professional", subscription_status: "ACTIVE" }]])
            .mockResolvedValueOnce([[{ cancel_at_period_end: 0 }]])
            .mockResolvedValue([[]]); // facturas y demas

        const d = await getTenantBillingDetails(TENANT);
        expect(d.planTier).toBe("Professional");
        expect(d.isEnterprise).toBe(false);
    });

    it("busca por tenant_id, no por id", async () => {
        queryMock.mockResolvedValue([[]]);
        await getTenantBillingDetails(TENANT);
        const sql = String(queryMock.mock.calls[0][0]);
        expect(sql).toContain("FROM Tenants");
        expect(sql).toContain("tenant_id = ?");
        expect(sql).not.toMatch(/WHERE\s+id\s*=/);
        expect(sql).not.toContain("TenantSaaSSubscriptions");
    });

    // Defaultear al tier mas alto es la falla insegura: promete capacidades que
    // el cliente no tiene y le esconde el boton de cambiar plan.
    it("si la lectura falla cae a Professional, no a Enterprise", async () => {
        queryMock.mockRejectedValueOnce(new Error("Table doesn't exist")).mockResolvedValue([[]]);
        const d = await getTenantBillingDetails(TENANT);
        expect(d.planTier).toBe("Professional");
        expect(d.isEnterprise).toBe(false);
    });

    it("Enterprise sigue viendose como Enterprise", async () => {
        queryMock
            .mockResolvedValueOnce([[{ tier: "Enterprise", subscription_status: "ACTIVE" }]])
            .mockResolvedValue([[]]);
        const d = await getTenantBillingDetails(TENANT);
        expect(d.planTier).toBe("Enterprise");
        expect(d.isEnterprise).toBe(true);
    });

    // "Modificar Suscripcion" bifurca con esto: con suscripcion va al portal de
    // Paddle (modificar la que existe), sin suscripcion va a contratar.
    it("avisa si el tenant tiene suscripcion de Paddle o es alta manual", async () => {
        queryMock
            .mockResolvedValueOnce([[{ tier: "Professional", subscription_status: "ACTIVE", paddle_subscription_id: null }]])
            .mockResolvedValue([[]]);
        expect((await getTenantBillingDetails(TENANT)).hasPaddleSubscription).toBe(false);

        queryMock.mockReset();
        queryMock
            .mockResolvedValueOnce([[{ tier: "Professional", subscription_status: "ACTIVE", paddle_subscription_id: "sub_1" }]])
            .mockResolvedValue([[]]);
        expect((await getTenantBillingDetails(TENANT)).hasPaddleSubscription).toBe(true);
    });
});

describe("la baja pedida por el cliente queda registrada", () => {
    it("marca cancel_at_period_end en Tenants por tenant_id", async () => {
        queryMock.mockResolvedValue([{ affectedRows: 1 }]);
        const res = await cancelTenantSubscription(TENANT, "admin@x.com");
        expect(res.success).toBe(true);
        const sql = String(queryMock.mock.calls[0][0]);
        expect(sql).toContain("UPDATE Tenants");
        expect(sql).toContain("cancel_at_period_end");
        expect(sql).toContain("tenant_id = ?");
    });

    // Antes devolvia success aunque no escribiera en ningun lado.
    it("si no actualizo ninguna fila, falla en vez de mentir", async () => {
        queryMock.mockResolvedValue([{ affectedRows: 0 }]);
        await expect(cancelTenantSubscription(TENANT, "admin@x.com")).rejects.toThrow();
    });
});
