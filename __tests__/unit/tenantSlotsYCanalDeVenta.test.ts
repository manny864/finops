// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const queryMock = vi.fn();
vi.mock("@/modules/storage/db", () => ({
    default: { query: (...a: unknown[]) => queryMock(...a) },
    initializeDatabase: vi.fn(async () => {}),
}));
vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn(async () => ({ email: "admin@x.com", claims: { oid: "oid-1" }, isCorporateDomain: false })),
    requireTenantRole: vi.fn(async () => ({ email: "admin@x.com", claims: { oid: "oid-1" } })),
    hasSystemRole: vi.fn(async () => false),
    AuthError: class AuthError extends Error { status = 403; },
}));
vi.mock("@/services/tenantAddons.service", () => ({
    TenantAddonsService: {
        getExtraQuota: vi.fn(async () => 0),
        getActiveAddons: vi.fn(async () => []),
    },
}));
vi.mock("@/services/paddlePrices.service", () => ({ getModulePrices: vi.fn(async () => ({ source: "catalog", modules: {} })) }));

import { POST as contratarTenant } from "@/app/api/admin/tenants/contract-tenant/route";
import { GET as verMarketplace } from "@/app/api/billing/marketplace/route";

const GUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const pedido = (body: unknown) => new NextRequest("http://localhost/api/admin/tenants/contract-tenant", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => queryMock.mockReset());

describe("el tenant adicional se cobra: no se regala capacidad", () => {
    // El SELECT traia additional_tenant_slots y nadie lo comparaba con nada:
    // cualquier Admin podia colgar tenants ilimitados sin comprar un slot.
    it("rechaza con 409 cuando no quedan slots libres", async () => {
        queryMock
            .mockResolvedValueOnce([[{ role: "Admin" }]])                              // rol del actor
            .mockResolvedValueOnce([[{ tier: "Business", additional_tenant_slots: 1, contract_id: "c1" }]])
            .mockResolvedValueOnce([[]])                                               // el nuevo tenant no existe
            .mockResolvedValueOnce([[{ additional_tenant_slots: 1 }]])                 // slots comprados
            .mockResolvedValueOnce([[{ n: 1 }]]);                                      // hijos ya colgados

        const res = await contratarTenant(pedido({ parentTenantId: "t1", newTenantId: GUID, organizationName: "Nueva SA" }));
        expect(res.status).toBe(409);
        expect((await res.json()).slots).toEqual({ used: 1, limit: 1 });
        // Lo que importa: no llego a insertar el tenant.
        expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO Tenants"))).toBe(false);
    });

    it("deja agregarlo cuando hay un slot libre", async () => {
        queryMock
            .mockResolvedValueOnce([[{ role: "Owner" }]])
            .mockResolvedValueOnce([[{ tier: "Business", additional_tenant_slots: 2, contract_id: "c1" }]])
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([[{ additional_tenant_slots: 2 }]])
            .mockResolvedValueOnce([[{ n: 1 }]])
            .mockResolvedValue([{ affectedRows: 1 }]);

        const res = await contratarTenant(pedido({ parentTenantId: "t1", newTenantId: GUID, organizationName: "Nueva SA" }));
        expect(res.status).toBe(200);
        expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO Tenants"))).toBe(true);
    });
});

describe("a los que compraron por el marketplace de Microsoft no se les ofrecen modulos", () => {
    it("devuelve catalogo vacio y el motivo", async () => {
        queryMock.mockResolvedValueOnce([[{ tier: "Professional", marketplace_source: "azure_marketplace" }]]);

        const res = await verMarketplace(new NextRequest("http://localhost/api/billing/marketplace?tenantId=t1"));
        const data = await res.json();
        expect(data.catalog).toEqual([]);
        expect(data.unavailableReason).toBe("azure_marketplace");
    });

    it("al que factura por Paddle le sigue apareciendo el catalogo", async () => {
        queryMock.mockResolvedValueOnce([[{ tier: "Professional", marketplace_source: null }]]);

        const res = await verMarketplace(new NextRequest("http://localhost/api/billing/marketplace?tenantId=t1"));
        const data = await res.json();
        expect(data.catalog.length).toBeGreaterThan(0);
        expect(data.unavailableReason).toBeUndefined();
    });
});
