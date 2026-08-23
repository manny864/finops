import { describe, it, expect, vi } from "vitest";

vi.mock("@/modules/storage/db", () => ({
    default: { query: vi.fn(async () => [[]]) },
}));

import { extractQuota } from "@/lib/azureQuotaTracking";

/** Imita el contrato `headers.get(name)` del SDK y de fetch. */
function headers(map: Record<string, string>) {
    const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
    return { get: (name: string) => lower[name.toLowerCase()] };
}

describe("Resource Graph", () => {
    it("lee el remanente y convierte el reset HH:MM:SS a segundos", () => {
        const q = extractQuota(
            headers({ "x-ms-user-quota-remaining": "11", "x-ms-user-quota-resets-after": "00:00:04" }),
            "RESOURCE_GRAPH"
        );
        expect(q).toEqual({ remaining: 11, resetsAfterSeconds: 4 });
    });

    it("maneja un reset de más de un minuto", () => {
        const q = extractQuota(
            headers({ "x-ms-user-quota-remaining": "3", "x-ms-user-quota-resets-after": "00:02:30" }),
            "RESOURCE_GRAPH"
        );
        expect(q?.resetsAfterSeconds).toBe(150);
    });

    it("acepta el remanente sin header de reset", () => {
        const q = extractQuota(headers({ "x-ms-user-quota-remaining": "7" }), "RESOURCE_GRAPH");
        expect(q).toEqual({ remaining: 7, resetsAfterSeconds: null });
    });

    it("0 restante es una medición válida, no ausencia de dato", () => {
        // Es justo el caso crítico: si se tratara como falsy se perdería el
        // momento exacto en que el tenant se quedó sin cuota.
        expect(extractQuota(headers({ "x-ms-user-quota-remaining": "0" }), "RESOURCE_GRAPH")).toEqual({
            remaining: 0,
            resetsAfterSeconds: null,
        });
    });

    it("devuelve null si la respuesta no trae cuota", () => {
        expect(extractQuota(headers({}), "RESOURCE_GRAPH")).toBeNull();
    });

    it("ignora un valor no numérico en vez de guardar NaN", () => {
        expect(extractQuota(headers({ "x-ms-user-quota-remaining": "n/a" }), "RESOURCE_GRAPH")).toBeNull();
    });

    it("ignora un reset con formato inesperado pero conserva el remanente", () => {
        const q = extractQuota(
            headers({ "x-ms-user-quota-remaining": "5", "x-ms-user-quota-resets-after": "raro" }),
            "RESOURCE_GRAPH"
        );
        expect(q).toEqual({ remaining: 5, resetsAfterSeconds: null });
    });
});

describe("ARM", () => {
    it("lee las lecturas restantes de la suscripción", () => {
        expect(extractQuota(headers({ "x-ms-ratelimit-remaining-subscription-reads": "11940" }), "ARM")).toEqual({
            remaining: 11940,
            resetsAfterSeconds: null,
        });
    });

    it("no confunde el header de ARG con el de ARM", () => {
        expect(extractQuota(headers({ "x-ms-user-quota-remaining": "11" }), "ARM")).toBeNull();
    });
});

describe("Cost Management", () => {
    it("toma el más restrictivo de los headers presentes", () => {
        const q = extractQuota(
            headers({
                "x-ms-ratelimit-remaining-microsoft.costmanagement-tenant-requests": "50",
                "x-ms-ratelimit-remaining-microsoft.costmanagement-entity-requests": "12",
                "x-ms-ratelimit-remaining-microsoft.costmanagement-client-requests": "30",
            }),
            "COST_MANAGEMENT"
        );
        // El que primero va a throttlear es el que manda.
        expect(q?.remaining).toBe(12);
    });

    it("funciona con un solo header presente", () => {
        const q = extractQuota(
            headers({ "x-ms-ratelimit-remaining-microsoft.costmanagement-entity-requests": "8" }),
            "COST_MANAGEMENT"
        );
        expect(q?.remaining).toBe(8);
    });

    it("devuelve null si no vino ninguno", () => {
        expect(extractQuota(headers({ "x-ms-request-id": "abc" }), "COST_MANAGEMENT")).toBeNull();
    });
});

describe("robustez", () => {
    it("no explota si headers.get lanza", () => {
        const hostile = { get: () => { throw new Error("boom"); } };
        expect(extractQuota(hostile as never, "ARM")).toBeNull();
    });
});
