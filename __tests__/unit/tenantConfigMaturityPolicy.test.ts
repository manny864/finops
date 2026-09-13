// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@/modules/storage/db", () => ({
    default: { query: (...a: unknown[]) => queryMock(...a) },
    initializeDatabase: vi.fn(async () => {}),
}));
vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn(async () => ({ tenantId: "t1" })),
    requireTenantRole: vi.fn(async () => ({ tenantId: "t1" })),
    AuthError: class AuthError extends Error { status = 403; },
}));

import { NextRequest } from "next/server";
import { PUT } from "@/app/api/admin/config/general/route";
import { isMaturityScorePolicy } from "@/services/tenantConfiguration.service";

// NextRequest y no Request: el handler lee `request.nextUrl.origin` para armar
// la URL del feed de Power BI que devuelve en la config.
const req = (body: unknown) =>
    new NextRequest("http://localhost/api/admin/config/general", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

// El PUT relee la config al final, así que el mock tiene que devolver una fila
// con forma de `TenantConfigRow` y no un objeto vacío.
const FILA = [[{ company_name: "ACME", logo_stored_name: null, webhook_url: null,
    theme_preference: "SYSTEM", maturity_score_policy: "self_assessment",
    itsm_system: "NONE", itsm_base_url: null, itsm_user_email: null,
    itsm_api_key_encrypted: null, itsm_project_key: null }]];

describe("política de madurez por la API de configuración", () => {
    beforeEach(() => { queryMock.mockReset(); queryMock.mockResolvedValue(FILA); });

    it("acepta las tres políticas y las persiste en Tenants", async () => {
        for (const pol of ["self_assessment", "telemetry", "blended_50_50"]) {
            queryMock.mockReset().mockResolvedValue(FILA);
            const res = await PUT(req({ tenantId: "t1", maturityScorePolicy: pol }));
            expect(res.status, pol).toBe(200);
            const sql = queryMock.mock.calls.map((c) => String(c[0])).join(" ");
            expect(sql, pol).toContain("UPDATE Tenants SET maturity_score_policy");
            expect(queryMock.mock.calls.some((c) => (c[1] as unknown[])?.includes(pol)), pol).toBe(true);
        }
    });

    it("un valor fuera de la lista devuelve 400 y NO toca la base", async () => {
        // Sin esta validación el valor moriría en el driver de MySQL con un
        // error de ENUM que no le dice nada al admin que lo mandó.
        const res = await PUT(req({ tenantId: "t1", maturityScorePolicy: "lo_que_sea" }));
        expect(res.status).toBe(400);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("si no viene la política, no se escribe", async () => {
        await PUT(req({ tenantId: "t1", theme: "DARK" }));
        // Se mira el UPDATE y no cualquier mención: el SELECT de relectura
        // nombra la columna siempre, así que buscarla suelta daba falso positivo.
        const updates = queryMock.mock.calls
            .map((c) => String(c[0]))
            .filter((q) => /UPDATE/i.test(q));
        expect(updates.join(" ")).not.toContain("maturity_score_policy");
        expect(updates.join(" ")).toContain("theme_preference");
    });

    it("el validador rechaza null, vacío y mayúsculas", () => {
        for (const v of [null, undefined, "", "TELEMETRY", 0, {}]) {
            expect(isMaturityScorePolicy(v)).toBe(false);
        }
    });
});
