// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => queryMock(...a) } }));

import { countStoredSubscriptions, getEffectiveSubscriptionLimit } from "@/lib/subscriptionQuota";

beforeEach(() => queryMock.mockReset());

describe("countStoredSubscriptions", () => {
    // El bug: antes contaba `TenantSubscriptions`, que es el registro de
    // facturación y NO tiene columna subscription_id. La consulta tiraba
    // "Unknown column", los catch se lo tragaban y el contador daba 0 SIEMPRE.
    it("suma delegaciones y suscripciones con costo, sin duplicar", async () => {
        queryMock
            .mockResolvedValueOnce([[{ subscription_id: "SUB-A" }, { subscription_id: "sub-b" }]])
            .mockResolvedValueOnce([[{ subscription_id: "sub-a" }, { subscription_id: "sub-c" }]]);

        // sub-a aparece en las dos fuentes con distinta capitalización: es una sola.
        expect(await countStoredSubscriptions("t1")).toBe(3);
    });

    it("si una tabla no existe, sigue contando con la otra en vez de dar 0", async () => {
        queryMock
            .mockRejectedValueOnce(new Error("Table 'TenantDelegations' doesn't exist"))
            .mockResolvedValueOnce([[{ subscription_id: "sub-a" }]]);
        expect(await countStoredSubscriptions("t1")).toBe(1);
    });

    it("un tenant sin nada da 0", async () => {
        queryMock.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
        expect(await countStoredSubscriptions("t1")).toBe(0);
    });
});

describe("getEffectiveSubscriptionLimit", () => {
    it("sin slots comprados rige el tope del plan", async () => {
        queryMock.mockResolvedValueOnce([[]]);
        expect(await getEffectiveSubscriptionLimit("t1", "Professional")).toBe(2);
    });

    // El enganche que hace vendible el add-on: la columna existía y nadie la leía.
    it("los slots comprados levantan el tope", async () => {
        queryMock.mockResolvedValueOnce([[{ max_allowed_subscriptions: 5 }]]);
        expect(await getEffectiveSubscriptionLimit("t1", "Professional")).toBe(5);
    });

    // Un override viejo o mal cargado no debe dejar al cliente por debajo de
    // lo que ya paga en su plan.
    it("un override MENOR al plan no baja el tope", async () => {
        queryMock.mockResolvedValueOnce([[{ max_allowed_subscriptions: 1 }]]);
        expect(await getEffectiveSubscriptionLimit("t1", "Business")).toBe(3);
    });

    it("Enterprise es ilimitado y ni consulta el override", async () => {
        expect(await getEffectiveSubscriptionLimit("t1", "Enterprise")).toBe(Infinity);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("si falla la consulta del override rige el plan, no un tope de 0", async () => {
        queryMock.mockRejectedValueOnce(new Error("db caída"));
        expect(await getEffectiveSubscriptionLimit("t1", "Business")).toBe(3);
    });
});
