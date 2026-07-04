import { describe, it, expect, beforeEach, vi } from "vitest";

// ---- Mocks -----------------------------------------------------------------
const queryMock = vi.fn();
const poolQueryMock = vi.fn();

vi.mock("@/modules/storage/db", () => ({
    default: { query: (...args: unknown[]) => queryMock(...args) },
}));

// Para probar el módulo db REAL (via importActual) sin abrir conexiones MySQL
vi.mock("mysql2/promise", () => ({
    default: {
        createPool: () => ({
            query: (...args: unknown[]) => poolQueryMock(...args),
            getConnection: vi.fn(),
        }),
    },
}));

vi.mock("@/lib/requestAuth", () => ({
    requireTenantAccess: vi.fn().mockResolvedValue({ tenantId: "real-tenant" }),
    AuthError: class AuthError extends Error {
        status = 401;
    },
}));

vi.mock("@/lib/mockData", () => ({
    isMockTenant: () => false,
}));

import { GET } from "@/app/api/intelligence/storage-efficiency/route";

function makeRequest(days = 30) {
    return {
        url: `http://localhost/api/intelligence/storage-efficiency?tenantId=real-tenant&days=${days}`,
        headers: new Headers(),
    } as any;
}

// Filas con la forma que devuelve el SELECT sobre CostMeterSnapshots
const METER_ROWS = [
    { MeterName: "Hot Block Blob", MeterSubCategory: "Hot Block Blob", MeterCategory: "Storage", service_name: "Storage", quantity: 1000, UnitOfMeasure: "GB", billedCost: 18.4 },
    { MeterName: "Cool Block Blob", MeterSubCategory: "Cool Block Blob", MeterCategory: "Storage", service_name: "Storage", quantity: 500, UnitOfMeasure: "GB", billedCost: 5 },
    { MeterName: "Archive Block Blob", MeterSubCategory: "Archive Block Blob", MeterCategory: "Storage", service_name: "Storage", quantity: 200, UnitOfMeasure: "GB", billedCost: 0.198 },
];

describe("storage-efficiency route", () => {
    beforeEach(() => {
        queryMock.mockReset();
    });

    it("usa CostMeterSnapshots como fuente primaria y separa tiers por subcategoría", async () => {
        queryMock.mockImplementation(async (sql: string) => {
            if (String(sql).includes("CostMeterSnapshots")) return [METER_ROWS, []];
            return [[], []];
        });

        const res = await GET(makeRequest());
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.mock).toBe(false);
        expect(body.diagnostics.source).toBe("meters");
        // Cada subcategoría conserva su tier — sin colapso entre sí
        expect(body.tiers.hot.gb).toBe(1000);
        expect(body.tiers.cool.gb).toBe(500);
        expect(body.tiers.archive.gb).toBe(200);
        expect(body.totalGb).toBe(1700);
        expect(body.totalCost).toBeCloseTo(23.6, 2);
    });

    it("cae a CostSnapshots (legacy) cuando no hay filas de meter", async () => {
        queryMock.mockImplementation(async (sql: string) => {
            if (String(sql).includes("CostMeterSnapshots")) return [[], []];
            // Fila legacy (query A): sin subcategoría, costo de Storage por RG
            return [[{
                MeterName: null, MeterSubCategory: null, MeterCategory: null,
                ServiceFamily: null, service_name: "Storage",
                quantity: 0, UnitOfMeasure: null, billedCost: 18.4,
            }], []];
        });

        const res = await GET(makeRequest());
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.diagnostics.source).toBe("legacy");
        // Sin subcategoría el tier se infiere: hot, con GB inferidos por costo/tarifa
        expect(body.tiers.hot.gb).toBeCloseTo(1000, 0);
        expect(body.tiers.cool.gb).toBe(0);
    });

    it("devuelve empty=true con mensaje cuando no hay datos en 365 días", async () => {
        queryMock.mockResolvedValue([[], []]);

        const res = await GET(makeRequest());
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.empty).toBe(true);
        expect(body.totalGb).toBe(0);
        expect(body.diagnostics.effectiveDays).toBe(365);
    });
});

describe("insertCostMeterSnapshotRow", () => {
    beforeEach(() => {
        poolQueryMock.mockReset();
        poolQueryMock.mockResolvedValue([[], []]);
    });

    it("escribe en CostMeterSnapshots normalizando meter fields a '' (clave única sin NULLs)", async () => {
        const { insertCostMeterSnapshotRow } =
            await vi.importActual<typeof import("@/modules/storage/db")>("@/modules/storage/db");
        await insertCostMeterSnapshotRow("t1", "2026-07-03", {
            subscriptionId: "sub-1",
            serviceName: "Storage",
            cost: 12.34,
        });

        expect(poolQueryMock).toHaveBeenCalledTimes(1);
        const [sql, params] = poolQueryMock.mock.calls[0];
        expect(String(sql)).toContain("INSERT INTO CostMeterSnapshots");
        expect(String(sql)).toContain("ON DUPLICATE KEY UPDATE");
        // meterCategory / meterSubCategory / meterName ausentes → '' (no NULL)
        expect(params).toEqual([
            "t1", "sub-1", "2026-07-03", "Storage",
            "", "", "",
            12.34, null, null,
        ]);
    });
});
