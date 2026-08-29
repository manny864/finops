import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock del pool ANTES de importar el módulo bajo prueba.
vi.mock("@/modules/storage/db", () => {
    const query = vi.fn();
    return { default: { query }, initializeDatabase: vi.fn() };
});

import pool from "@/modules/storage/db";
import { getAllSubscriptionsForTenant } from "@/lib/azure";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

const ARM_SUB = "AAAAAAAA-1111-2222-3333-444444444444"; // ARM devuelve el GUID en mayúsculas
const DB_SUB = "bbbbbbbb-1111-2222-3333-444444444444";

const credential = { getToken: async () => ({ token: "fake" }) } as any;

beforeEach(() => {
    query.mockReset();
    // Descubrimiento ARM: una suscripción habilitada.
    vi.stubGlobal("fetch", vi.fn(async () => ({
        ok: true,
        json: async () => ({ value: [{ subscriptionId: ARM_SUB, state: "Enabled" }] }),
    })));

    query.mockImplementation(async (sql: string) => {
        if (/TenantDelegations/i.test(sql)) return [[]];
        if (/CostSnapshots/i.test(sql)) return [[{ subscription_id: DB_SUB }]];
        // MEJ-25: la excluida se guarda siempre en minúsculas.
        if (/TenantExcludedSubscriptions/i.test(sql)) return [[{ subscription_id: ARM_SUB.toLowerCase() }]];
        return [[]];
    });
});

describe("MEJ-25 — suscripciones desvinculadas", () => {
    it("excluye la suscripción desvinculada aunque ARM la devuelva en mayúsculas", async () => {
        const subs = await getAllSubscriptionsForTenant("tenant-1", credential);
        expect(subs).toEqual([DB_SUB]);
    });

    it("sin exclusiones devuelve todo lo descubierto", async () => {
        query.mockImplementation(async (sql: string) => {
            if (/CostSnapshots/i.test(sql)) return [[{ subscription_id: DB_SUB }]];
            return [[]];
        });
        const subs = await getAllSubscriptionsForTenant("tenant-1", credential);
        expect(subs.sort()).toEqual([ARM_SUB, DB_SUB].sort());
    });

    it("si la tabla no existe todavía, no excluye nada", async () => {
        query.mockImplementation(async (sql: string) => {
            if (/TenantExcludedSubscriptions/i.test(sql)) {
                const err: any = new Error("Table doesn't exist");
                err.code = "ER_NO_SUCH_TABLE";
                throw err;
            }
            if (/CostSnapshots/i.test(sql)) return [[{ subscription_id: DB_SUB }]];
            return [[]];
        });
        const subs = await getAllSubscriptionsForTenant("tenant-1", credential);
        expect(subs).toContain(ARM_SUB);
    });
});
