// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const queryMock = vi.fn();
vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => queryMock(...a) } }));
vi.mock("@/lib/requestAuth", () => ({
    requireSuperAdmin: vi.fn(async () => ({ email: "admin@cscloudsolutions.com.ar" })),
    AuthError: class AuthError extends Error { status = 403; },
}));
vi.mock("@/lib/azureApiMetrics", () => ({ leerUsoApiAzure: vi.fn(async () => []) }));

import { GET } from "@/app/api/superadmin/platform-usage/route";

const DEMO = "33333333-4444-5555-6666-777777777777";
const REAL = "54d7cf18-0baa-4da7-8242-fbf59a92aaac";

beforeEach(() => queryMock.mockReset());

/**
 * El consumo de IA de los tenants DEMO es real: el Copilot y el reporte
 * ejecutivo llaman al proveedor aunque el tenant sea sintético, y esos tokens
 * los paga la casa. No se ocultan --esconder un costo sería peor-- pero van
 * marcados: mezclados con los clientes, el panel operativo se lee como si
 * tuviera datos mock.
 */
describe("consumo de IA: los tenants demo van separados", () => {
    it("marca las filas de tenants demo y las totaliza aparte", async () => {
        queryMock
            .mockResolvedValueOnce([[
                { tenant_id: REAL, company_name: "RPA365 SA", source: "platform", llamadas: 51, inputTokens: 100, outputTokens: 50 },
                { tenant_id: DEMO, company_name: null, source: "platform", llamadas: 4, inputTokens: 20, outputTokens: 10 },
            ]])
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([[]]);

        const res = await GET(new NextRequest("http://localhost/api/superadmin/platform-usage?view=ai"));
        const data = await res.json();

        const real = data.porTenant.find((r: any) => r.tenant_id === REAL);
        const demo = data.porTenant.find((r: any) => r.tenant_id === DEMO);
        expect(real.esDemo).toBe(false);
        expect(demo.esDemo).toBe(true);
        // 20 + 10 del tenant demo, sin arrastrar los del cliente real.
        expect(data.demoTokens).toBe(30);
    });

    it("una fila sin tenant no se marca como demo", async () => {
        queryMock
            .mockResolvedValueOnce([[{ tenant_id: null, company_name: null, source: "platform", llamadas: 9, inputTokens: 5, outputTokens: 5 }]])
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([[]]);

        const res = await GET(new NextRequest("http://localhost/api/superadmin/platform-usage?view=ai"));
        const data = await res.json();
        expect(data.porTenant[0].esDemo).toBe(false);
        expect(data.demoTokens).toBe(0);
    });
});
