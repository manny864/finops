import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { applyMock, saveCacheMock, requireRoleMock, requireTierMock } = vi.hoisted(() => ({
    applyMock: vi.fn(),
    saveCacheMock: vi.fn(async () => {}),
    requireRoleMock: vi.fn(async () => ({ tenantId: "t1", email: "admin@x.com" })),
    requireTierMock: vi.fn(async () => {}),
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn(async () => ({ tenantId: "t1" })),
    requireTenantRole: requireRoleMock,
    requireTenantTier: requireTierMock,
    AuthError: class AuthError extends Error {
        status = 403;
        constructor(m: string, s = 403) { super(m); this.status = s; }
    },
}));
vi.mock("@/lib/mockData", () => ({ isMockTenant: (t: string) => t === "demo_tenant", getMockTagGovernanceSummary: () => ({}) }));
vi.mock("@/lib/azure", () => ({
    getAzureCredential: vi.fn(async () => ({})),
    getSubscriptionsForTenant: vi.fn(async () => []),
}));
vi.mock("@/services/azureTagGovernance.service", () => ({
    scanTagGovernanceLive: vi.fn(),
    getMockTagGovernanceSummary: vi.fn(),
    saveLocalCachedTags: saveCacheMock,
}));
vi.mock("@/services/tagInheritanceService", () => ({ applyTagInheritance: applyMock }));

import { POST } from "@/app/api/governance/tags/route";

const body = (b: any) => new NextRequest("http://localhost/api/governance/tags?tenantId=t1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(b),
});

beforeEach(() => {
    applyMock.mockReset();
    saveCacheMock.mockReset();
    requireRoleMock.mockReset().mockResolvedValue({ tenantId: "t1", email: "admin@x.com" });
    requireTierMock.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/governance/tags — el etiquetado tiene que llegar a Azure", () => {
    // El bug reportado: la ruta sólo escribía en LocalResourceTagsCache y
    // devolvía success, así que la UI decía "etiquetas aplicadas" con el
    // recurso intacto en Azure.
    it("hace el PATCH real contra ARM, no sólo la caché local", async () => {
        applyMock.mockResolvedValue([{ resourceId: "/subscriptions/s/r1", success: true }]);

        const res = await POST(body({ resourceIds: ["/subscriptions/s/r1"], tags: { env: "prod" } }));
        const json = await res.json();

        expect(applyMock).toHaveBeenCalledTimes(1);
        const [, ops] = applyMock.mock.calls[0];
        expect(ops).toEqual([{ resourceId: "/subscriptions/s/r1", tagsToMerge: { env: "prod" } }]);
        expect(json.updatedCount).toBe(1);
    });

    // "Si la etiqueta existe, que se pueda sustituir el valor": ARM resuelve esto
    // con `operation: Merge`, que agrega claves nuevas Y PISA el valor de las que
    // ya existen (sólo `Delete` borra, y `Replace` reemplaza el set entero).
    // Lo que controla este código es que el valor editado llegue tal cual al
    // payload, sin filtrar las claves preexistentes.
    it("manda el valor NUEVO de una etiqueta que ya existía (sustitución)", async () => {
        applyMock.mockResolvedValue([{ resourceId: "r1", success: true }]);

        // El recurso ya tenía Environment=dev; el usuario lo edita a prod.
        await POST(body({ resourceIds: ["r1"], tags: { Environment: "prod", Role: "api" } }));

        const [, ops] = applyMock.mock.calls[0];
        expect(ops[0].tagsToMerge).toEqual({ Environment: "prod", Role: "api" });
        // La clave preexistente NO se filtra del payload: si se filtrara, Azure
        // nunca vería el valor nuevo y la etiqueta quedaría en 'dev'.
        expect(ops[0].tagsToMerge.Environment).toBe("prod");
    });

    it("la caché local queda con el valor sustituido, no con el viejo", async () => {
        applyMock.mockResolvedValue([{ resourceId: "r1", success: true }]);

        await POST(body({ resourceIds: ["r1"], tags: { Environment: "prod" } }));

        expect(saveCacheMock).toHaveBeenCalledWith("t1", "r1", { Environment: "prod" });
    });

    it("exige Admin/Owner: escribir tags muta el Azure del cliente", async () => {
        applyMock.mockResolvedValue([{ resourceId: "r1", success: true }]);
        await POST(body({ resourceIds: ["r1"], tags: { env: "prod" } }));
        expect(requireRoleMock).toHaveBeenCalledWith(expect.anything(), "t1", ["Admin", "Owner"]);
    });

    it("cachea SÓLO lo que Azure aceptó, para que la UI no muestre conforme lo que falló", async () => {
        applyMock.mockResolvedValue([
            { resourceId: "r_ok", success: true },
            { resourceId: "r_fail", success: false, error: "HTTP 403: AuthorizationFailed" },
        ]);

        const res = await POST(body({ resourceIds: ["r_ok", "r_fail"], tags: { env: "prod" } }));
        const json = await res.json();

        expect(saveCacheMock).toHaveBeenCalledTimes(1);
        expect(saveCacheMock.mock.calls[0][1]).toBe("r_ok");
        expect(json.updatedCount).toBe(1);
        expect(json.failedCount).toBe(1);
        expect(json.message).toContain("1 de 2");
    });

    it("si Azure rechaza todo devuelve error, no un success falso", async () => {
        applyMock.mockResolvedValue([
            { resourceId: "r1", success: false, error: "HTTP 403: AuthorizationFailed" },
        ]);

        const res = await POST(body({ resourceIds: ["r1"], tags: { env: "prod" } }));
        const json = await res.json();

        expect(res.status).toBe(502);
        expect(json.updatedCount).toBe(0);
        expect(json.details).toContain("AuthorizationFailed");
        expect(saveCacheMock).not.toHaveBeenCalled();
    });

    // El rol Tag Contributor del SP recién se otorga desde Business
    // (onboardingScriptTemplate.ts), así que sin este guard un Professional
    // recibiría un AuthorizationFailed opaco de Azure en vez de un mensaje de tier.
    it("exige tier Business: es la remediación de tags que define canRemediateTags", async () => {
        applyMock.mockResolvedValue([{ resourceId: "r1", success: true }]);
        await POST(body({ resourceIds: ["r1"], tags: { env: "prod" } }));
        expect(requireTierMock).toHaveBeenCalledWith(expect.anything(), "t1", "Business");
    });

    it("un tier insuficiente corta ANTES de tocar Azure", async () => {
        const { AuthError } = await import("@/lib/requestAuth");
        requireTierMock.mockRejectedValue(new (AuthError as any)("Requiere plan Business", 402));

        const res = await POST(body({ resourceIds: ["r1"], tags: { env: "prod" } }));

        expect(res.status).toBe(402);
        expect(applyMock).not.toHaveBeenCalled();
        expect(saveCacheMock).not.toHaveBeenCalled();
    });

    it("el tenant demo sigue simulando sin tocar Azure", async () => {
        const req = new NextRequest("http://localhost/api/governance/tags?tenantId=demo_tenant", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resourceIds: ["r1"], tags: { env: "prod" } }),
        });
        const res = await POST(req);

        expect(res.status).toBe(200);
        expect(applyMock).not.toHaveBeenCalled();
        expect(requireRoleMock).not.toHaveBeenCalled();
    });
});
