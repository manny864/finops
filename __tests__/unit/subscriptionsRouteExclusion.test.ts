import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { getExcludedMock } = vi.hoisted(() => ({ getExcludedMock: vi.fn() }));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn().mockResolvedValue({ tenantId: "test-tenant" }),
    AuthError: class AuthError extends Error {
        status = 401;
    },
}));

// El filtro por directorio va sin mockear a propósito: si se lo reemplaza por
// un stub, el test deja de mirar justamente lo que separa a dos clientes.
vi.mock("@/lib/azure", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/azure")>()),
    getAzureCredential: vi.fn(async () => ({
        getToken: vi.fn(async () => ({ token: "fake" })),
    })),
    getExcludedSubscriptionIds: getExcludedMock,
}));

vi.mock("@/modules/storage/db", () => ({
    default: { query: vi.fn(async () => [[{ tier: "Enterprise" }]]) },
}));

const SUB_VISIBLE = "11111111-1111-1111-1111-111111111111";
const SUB_UNLINKED = "22222222-2222-2222-2222-222222222222"; // "RPA Patrocinio Producción"
const SUB_AJENA = "33333333-3333-3333-3333-333333333333"; // vive en OTRO directorio
const TENANT = "test-tenant";

beforeEach(() => {
    getExcludedMock.mockReset().mockResolvedValue(new Set());
    vi.stubGlobal("fetch", vi.fn(async () => ({
        ok: true,
        json: async () => ({
            value: [
                { subscriptionId: SUB_VISIBLE, displayName: "Producción", state: "Enabled", tenantId: TENANT },
                { subscriptionId: SUB_UNLINKED, displayName: "RPA Patrocinio Producción", state: "Enabled", tenantId: TENANT },
                // ARM la lista porque el SP tiene RBAC sobre ella, pero es de otro cliente
                { subscriptionId: SUB_AJENA, displayName: "Producción", state: "Enabled", tenantId: "otro-directorio" },
            ],
        }),
    })));
});

describe("GET /api/subscriptions — MEJ-25 (excluye desvinculadas del selector)", () => {
    it("una suscripción desvinculada no aparece en el selector de Alcance", async () => {
        getExcludedMock.mockResolvedValue(new Set([SUB_UNLINKED.toLowerCase()]));

        const { GET } = await import("@/app/api/subscriptions/route");
        const req = new NextRequest(`http://localhost/api/subscriptions?tenantId=${TENANT}`);
        const res = await GET(req);
        const body = await res.json();

        const ids = body.subscriptions.map((s: any) => s.id);
        expect(ids).toContain(SUB_VISIBLE);
        expect(ids).not.toContain(SUB_UNLINKED);
        expect(body.totalAvailable).toBe(1);
    });

    it("sin exclusiones, devuelve todo lo que ve Azure", async () => {
        const { GET } = await import("@/app/api/subscriptions/route");
        const req = new NextRequest(`http://localhost/api/subscriptions?tenantId=${TENANT}`);
        const res = await GET(req);
        const body = await res.json();

        expect(body.subscriptions.map((s: any) => s.id).sort()).toEqual([SUB_UNLINKED, SUB_VISIBLE].sort());
        expect(body.totalAvailable).toBe(2);
    });

    /*
     * Un token del tenant A no lista sólo las suscripciones de A: basta con que
     * el service principal tenga RBAC sobre una de otro directorio. Pasó en
     * producción con dos clientes de nombre parecido —"CSCloudSolutions" y
     * "CS CloudSolutions Azure Patrocinio"— y el selector las mostraba juntas.
     */
    it("una suscripción de otro directorio nunca entra al selector", async () => {
        const { GET } = await import("@/app/api/subscriptions/route");
        const req = new NextRequest(`http://localhost/api/subscriptions?tenantId=${TENANT}`);
        const body = await (await GET(req)).json();

        expect(body.subscriptions.map((s: any) => s.id)).not.toContain(SUB_AJENA);
    });
});
