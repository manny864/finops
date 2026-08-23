import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    isMgScopeKnownUnusable,
    markMgScopeUnusable,
    isStructuralScopeFailure,
    resetMgScopeCache,
} from "@/modules/collectors/azure/billing/billingHelpers";

/**
 * Los cuatro servicios de billing intentan el scope de management group antes
 * de caer a suscripciones. En tenants donde ese MG no sirve, cada intento se
 * lleva 3 reintentos con backoff contra la cuota de Cost Management. Ése fue el
 * 429 sostenido que dejó 15 días sin ingerir en el tenant 81ebe027.
 */
beforeEach(() => {
    resetMgScopeCache();
    vi.restoreAllMocks();
});

describe("cache de scope de management group inutilizable", () => {
    it("un tenant nuevo no está marcado", () => {
        expect(isMgScopeKnownUnusable("t1")).toBe(false);
    });

    it("una vez marcado, se recuerda", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        markMgScopeUnusable("t1", "does not have any valid subscriptions");
        expect(isMgScopeKnownUnusable("t1")).toBe(true);
    });

    it("la marca es por tenant y no contamina a los demás", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        markMgScopeUnusable("t1", "motivo");
        expect(isMgScopeKnownUnusable("t2")).toBe(false);
    });

    it("expira, para que el scope se re-pruebe si el cliente crea el MG después", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        markMgScopeUnusable("t1", "motivo");
        expect(isMgScopeKnownUnusable("t1")).toBe(true);

        // 7 h > TTL de 6 h.
        vi.spyOn(Date, "now").mockReturnValue(Date.now() + 7 * 60 * 60 * 1000);
        expect(isMgScopeKnownUnusable("t1")).toBe(false);
    });

    it("marcar dos veces no reinicia el TTL indefinidamente", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        markMgScopeUnusable("t1", "primera");
        markMgScopeUnusable("t1", "segunda");
        expect(warn).toHaveBeenCalledTimes(1);
    });
});

describe("qué cuenta como fallo estructural", () => {
    it("el mensaje real de Azure para un MG sin suscripciones", () => {
        // "Management group 81ebe027... does not have any valid subscriptions."
        expect(isStructuralScopeFailure(new Error("Management group 81ebe027 does not have any valid subscriptions."))).toBe(true);
    });

    it("scope inexistente o sin permisos", () => {
        expect(isStructuralScopeFailure(new Error("NotFound"))).toBe(true);
        expect(isStructuralScopeFailure(new Error("AuthorizationFailed"))).toBe(true);
        expect(isStructuralScopeFailure(new Error("MG scope returned 0 rows, falling back"))).toBe(true);
    });

    it("un 429 NO es estructural: es temporal y el scope puede seguir sirviendo", () => {
        // Marcar por throttling haría que el tenant abandonara el scope
        // agregado —el más barato— justo cuando más conviene usarlo.
        const throttled: any = new Error("Too many requests. Please retry.");
        throttled.statusCode = 429;
        expect(isStructuralScopeFailure(throttled)).toBe(false);

        const byCode: any = new Error("rate limited");
        byCode.code = "RateLimiting";
        expect(isStructuralScopeFailure(byCode)).toBe(false);
    });

    it("un error de red genérico tampoco se marca", () => {
        expect(isStructuralScopeFailure(new Error("socket hang up"))).toBe(false);
    });
});
