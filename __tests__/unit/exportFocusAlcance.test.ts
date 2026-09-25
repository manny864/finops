// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => {
    class AuthErrorMock extends Error { status = 401; }
    return { AuthErrorMock };
});
vi.mock("@/lib/requestAuth", () => ({
    AuthError: auth.AuthErrorMock,
    requireTenantRole: async () => ({ email: "a@b" }),
    requireTenantTier: async () => ({ email: "a@b" }),
    requireTenantAccess: async () => ({ email: "a@b" }),
}));

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/modules/storage/db", () => ({ default: db }));

import { GET } from "@/app/api/exports/focus/route";

/**
 * MEJ-34: el export honra el alcance de Perspective del selector transversal.
 * Es el primer consumidor que lo hace, y se eligió porque filtra FILA POR FILA:
 * no hay una agregación que pueda quedar descuadrada.
 */
const FILAS = [
    { tenant_id: "t", subscription_id: "s1", resource_group: "rg-prod", service_name: "Storage", cost_usd: 100, currency: "USD", Tags: JSON.stringify({ Environment: "prod" }), ResourceId: "/subscriptions/s1/resourceGroups/rg-prod/providers/Microsoft.Compute/disks/d1" },
    { tenant_id: "t", subscription_id: "s1", resource_group: "rg-dev-1", service_name: "Compute", cost_usd: 50, currency: "USD", Tags: JSON.stringify({ Environment: "dev" }), ResourceId: "/subscriptions/s1/resourceGroups/rg-dev-1/providers/Microsoft.Compute/disks/d2" },
    { tenant_id: "t", subscription_id: "s1", resource_group: "rg-qa", service_name: "Compute", cost_usd: 25, currency: "USD", Tags: JSON.stringify({ Environment: "qa" }), ResourceId: "/subscriptions/s1/resourceGroups/rg-qa/providers/Microsoft.Compute/disks/d3" },
];

function conBase(conPerspectiva: boolean) {
    db.query.mockReset();
    db.query.mockImplementation(async (sql: unknown) => {
        const q = String(sql);
        if (/FROM Perspectives/i.test(q)) return [conPerspectiva ? [{ id: 7, name: "Entorno", description: null }] : []];
        if (/FROM PerspectiveRules/i.test(q)) {
            return [[{ id: 1, perspective_id: 7, group_name: "Producción", match_type: "tag", match_key: "Environment", match_value: "prod", sort_order: 0 }]];
        }
        if (/FROM CostSnapshots/i.test(q)) return [FILAS];
        return [[]];
    });
}

async function exportar(query: string): Promise<string[]> {
    const r = await GET(new NextRequest(new URL(`https://x/api/exports/focus?tenantId=t&format=ndjson${query}`)) as any);
    expect(r.status).toBe(200);
    // El stream emite STRINGS; `.text()` en Node exige bytes y tira
    // "Received non-Uint8Array chunk". Se lee a mano, que ademas no depende de
    // como el runtime decida serializarlo.
    const reader = (r.body as any).getReader();
    let texto = "";
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        texto += typeof value === "string" ? value : new TextDecoder().decode(value);
    }
    return texto.split("\n").filter(Boolean);
}

describe("export FOCUS con alcance de Perspective", () => {
    beforeEach(() => db.query.mockReset());

    it("sin alcance exporta todo", async () => {
        conBase(true);
        expect(await exportar("")).toHaveLength(3);
    });

    it("con un grupo exporta SOLO sus filas", async () => {
        conBase(true);
        const lineas = await exportar("&perspective=7&pgroup=Producci%C3%B3n");
        expect(lineas).toHaveLength(1);
        expect(JSON.parse(lineas[0]).ResourceName).toBe("rg-prod");
    });

    it("acotado al sin asignar deja las que ninguna regla toma", async () => {
        conBase(true);
        const lineas = await exportar("&perspective=7&pgroup=__unassigned__");
        expect(lineas.map((l) => JSON.parse(l).ResourceName).sort()).toEqual(["rg-dev-1", "rg-qa"]);
    });

    it("una perspective que no es del tenant NO vacia el export", async () => {
        // Devolver cero filas se leeria como "ese grupo no tiene gasto".
        conBase(false);
        expect(await exportar("&perspective=999&pgroup=Producci%C3%B3n")).toHaveLength(3);
    });
});
