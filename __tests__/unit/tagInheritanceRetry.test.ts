import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applyTagInheritance, describeArmError } from "@/services/tagInheritanceService";

const credential = { getToken: async () => ({ token: "fake" }) } as any;
const ops = [{ resourceId: "/subscriptions/s/rg/r1", tagsToMerge: { Environment: "prod" } }];

// El cuerpo EXACTO que devolvió ARM en producción: el motivo real viene
// doblemente escapado dentro de error.message.
const CONFLICT_BODY = JSON.stringify({
    error: {
        code: "ProviderError",
        message: JSON.stringify({
            error: {
                code: "ManagedEnvironmentOperationInProgress",
                message: "Cannot modify Container Apps environment cscs-finops-prod-westus2-cae because another operation is in progress.",
            },
        }),
    },
});

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

/** Corre la promesa dejando que los setTimeout del backoff venzan al instante. */
async function runWithTimers<T>(p: Promise<T>): Promise<T> {
    const done = p.then((v) => v);
    await vi.runAllTimersAsync();
    return done;
}

describe("applyTagInheritance — 409 de ARM", () => {
    it("reintenta el 409 y termina en éxito cuando el recurso se libera", async () => {
        // Antes salía al primer intento: un conflicto pasajero quedaba como
        // fallo definitivo (el caso reportado, 58 de 59 recursos).
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 409, text: async () => CONFLICT_BODY })
            .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "" });
        vi.stubGlobal("fetch", fetchMock);

        const results = await runWithTimers(applyTagInheritance(credential, ops));

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(results[0].success).toBe(true);
    });

    it("si el 409 persiste, informa el código real de Azure y sugiere reintentar", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 409, text: async () => CONFLICT_BODY })));

        const results = await runWithTimers(applyTagInheritance(credential, ops));

        expect(results[0].success).toBe(false);
        expect(results[0].error).toContain("ManagedEnvironmentOperationInProgress");
        expect(results[0].error).toContain("reintentá en unos minutos");
        // Y NO el JSON crudo que se mostraba antes.
        expect(results[0].error).not.toContain('{"error"');
    });

    it("un error NO transitorio (403) no se reintenta", async () => {
        const body = JSON.stringify({ error: { code: "AuthorizationFailed", message: "does not have authorization" } });
        const fetchMock = vi.fn(async () => ({ ok: false, status: 403, text: async () => body }));
        vi.stubGlobal("fetch", fetchMock);

        const results = await runWithTimers(applyTagInheritance(credential, ops));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(results[0].error).toContain("AuthorizationFailed");
        expect(results[0].error).not.toContain("reintentá");
    });
});

describe("describeArmError", () => {
    it("desanida el error real que ARM esconde dentro de error.message", () => {
        const out = describeArmError(409, CONFLICT_BODY);
        expect(out).toContain("ManagedEnvironmentOperationInProgress");
        expect(out).toContain("cscs-finops-prod-westus2-cae");
    });

    it("tolera un cuerpo que no es JSON sin romperse", () => {
        expect(describeArmError(500, "Gateway timeout")).toBe("HTTP 500: Gateway timeout");
    });
});
