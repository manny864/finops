import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock del pool ANTES de importar el módulo bajo prueba.
vi.mock("@/modules/storage/db", () => {
    const query = vi.fn();
    return { default: { query }, initializeDatabase: vi.fn() };
});

import pool from "@/modules/storage/db";
import { getAllSubscriptionsForTenant, resetSubscriptionsCache } from "@/lib/azure";

const query = pool.query as unknown as ReturnType<typeof vi.fn>;

const ARM_SUB = "AAAAAAAA-1111-2222-3333-444444444444"; // ARM devuelve el GUID en mayúsculas
const DB_SUB = "bbbbbbbb-1111-2222-3333-444444444444";

const credential = { getToken: async () => ({ token: "fake" }) } as any;

beforeEach(() => {
    query.mockReset();
    // El descubrimiento cachea por tenant durante 60 s. Los tres casos usan el
    // mismo tenant con datos distintos, así que sin esto el segundo y el
    // tercero leerían el resultado del primero.
    resetSubscriptionsCache();
    // Descubrimiento ARM: una suscripción habilitada.
    vi.stubGlobal("fetch", vi.fn(async () => ({
        ok: true,
        // tenantId: ARM lo devuelve siempre y listTenantSubscriptions descarta lo ajeno
        json: async () => ({ value: [{ subscriptionId: ARM_SUB, state: "Enabled", tenantId: "tenant-1" }] }),
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
        expect(subs).toEqual([]);
    });

    it("sin exclusiones devuelve lo que ARM atribuye al tenant, no snapshots viejos", async () => {
        query.mockImplementation(async (sql: string) => {
            if (/CostSnapshots/i.test(sql)) return [[{ subscription_id: DB_SUB }]];
            return [[]];
        });
        const subs = await getAllSubscriptionsForTenant("tenant-1", credential);
        expect(subs).toEqual([ARM_SUB]);
    });

    it("si ARM no puede atribuir, no reintroduce snapshots viejos", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
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
        expect(subs).toEqual([]);
    });
});
