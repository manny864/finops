// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@/modules/storage/db", () => ({
    default: { query: (...a: unknown[]) => queryMock(...a) },
    initializeDatabase: vi.fn(async () => {}),
}));
vi.mock("@/lib/mockData", () => ({ isMockTenant: () => false }));

import { TenantAddonsService } from "@/services/tenantAddons.service";

beforeEach(() => queryMock.mockReset());

describe("el modulo con suscripcion mensual se acredita una sola vez", () => {
    // Cada cobro mensual llega como su propio transaction.completed. Sin corte,
    // la renovacion nº12 dejaba 12 filas activas del mismo modulo -- y en los
    // add-ons de cuota `getExtraQuota` SUMA las filas: 12 slots por uno pago.
    it("la renovacion no crea una fila nueva", async () => {
        queryMock
            .mockResolvedValueOnce([[]])                 // ensureTableExists
            .mockResolvedValueOnce([[{ id: 7 }]])        // ya hay uno activo
            .mockResolvedValueOnce([{ affectedRows: 1 }]); // update del transaction_id

        const res = await TenantAddonsService.purchaseAddon("t1", "mod_security", "recurring", 1, "txn_2");

        expect(res.id).toBe(7);
        expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO TenantAddons"))).toBe(false);
    });

    it("la primera compra si inserta, y sin vencimiento", async () => {
        queryMock
            .mockResolvedValueOnce([[]])            // ensureTableExists
            .mockResolvedValueOnce([[]])            // no hay activo
            .mockResolvedValueOnce([{ insertId: 9 }]);

        const res = await TenantAddonsService.purchaseAddon("t1", "mod_security", "recurring", 1, "txn_1");

        expect(res.expiresAt).toBeNull();
        const insert = queryMock.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO TenantAddons"));
        expect(insert).toBeTruthy();
    });

    it("el pase temporal se sigue apilando: comprar otro extiende el acceso", async () => {
        queryMock
            .mockResolvedValueOnce([[]])
            .mockResolvedValueOnce([{ insertId: 10 }]);

        const res = await TenantAddonsService.purchaseAddon("t1", "mod_security", "pass", 3, "txn_3");

        expect(res.expiresAt).not.toBeNull();
        // No consulta si ya hay uno activo: los pases se acumulan a proposito.
        expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("addon_type = 'recurring'"))).toBe(false);
    });
});
