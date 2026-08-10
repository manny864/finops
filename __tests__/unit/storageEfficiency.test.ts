import { describe, it, expect, beforeEach, vi } from "vitest";

// ---- Mocks -----------------------------------------------------------------
const queryMock = vi.fn();
const poolQueryMock = vi.fn();
const getAzureCredentialMock = vi.fn();
const getResourceGraphClientMock = vi.fn();

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

vi.mock("@/lib/azure", () => ({
    getAzureCredential: (...args: unknown[]) => getAzureCredentialMock(...args),
    getResourceGraphClient: (...args: unknown[]) => getResourceGraphClientMock(...args),
    getSubscriptionsForTenant: vi.fn(),
}));

import { GET } from "@/app/api/intelligence/storage-efficiency/route";

function makeRequest(days = 30) {
    return {
        url: `http://localhost/api/intelligence/storage-efficiency?tenantId=real-tenant&days=${days}`,
        headers: new Headers(),
    } as any;
}

// Filas con la forma que devuelve el SELECT sobre CostMeterSnapshots.
// MeterSubCategory lleva el NOMBRE del meter (dimensión 'Meter' de Cost
// Management) — ahí vive el tier real, p.ej. "Cool LRS Data Stored".
const METER_ROWS = [
    { MeterName: "Hot LRS Data Stored", MeterSubCategory: "Hot LRS Data Stored", MeterCategory: "", service_name: "Storage", quantity: 1000, UnitOfMeasure: "GB", billedCost: 18.4 },
    { MeterName: "Cool LRS Data Stored", MeterSubCategory: "Cool LRS Data Stored", MeterCategory: "", service_name: "Storage", quantity: 500, UnitOfMeasure: "GB", billedCost: 5 },
    { MeterName: "Archive RA-GRS Data Stored", MeterSubCategory: "Archive RA-GRS Data Stored", MeterCategory: "", service_name: "Storage", quantity: 200, UnitOfMeasure: "GB", billedCost: 0.198 },
];

describe("storage-efficiency route", () => {
    beforeEach(() => {
        queryMock.mockReset();
        getAzureCredentialMock.mockReset();
        getResourceGraphClientMock.mockReset();
        getAzureCredentialMock.mockResolvedValue({
            getToken: vi.fn().mockResolvedValue({ token: "test-token" }),
        });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ value: [] }), { status: 200 })));
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
        // Sin datapoint de Azure Monitor, el costo legacy no se convierte en capacidad.
        expect(body.tiers.hot.gb).toBe(0);
        expect(body.tiers.hot.cost).toBeCloseTo(18.4, 2);
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

    it("no escribe snapshots ni acumula capacidad entre refreshes", async () => {
        const fiveGbInBytes = 5 * 1024 * 1024 * 1024;
        const fetchMock = vi.fn(async (url: string) => {
            if (url.includes("/subscriptions?")) {
                return new Response(JSON.stringify({ value: [{ subscriptionId: "sub-1" }] }), { status: 200 });
            }
            return new Response(JSON.stringify({
                value: [{ timeseries: [{ data: [{ average: fiveGbInBytes }, { average: null }] }] }],
            }), { status: 200 });
        });
        vi.stubGlobal("fetch", fetchMock);
        getResourceGraphClientMock.mockResolvedValue({
            resources: vi.fn().mockResolvedValue({
                data: [{
                    id: "/subscriptions/sub-1/resourceGroups/rg-storage/providers/Microsoft.Storage/storageAccounts/storageone",
                    name: "storageone",
                    resourceGroup: "rg-storage",
                    subscriptionId: "sub-1",
                    location: "eastus",
                    sku: { name: "Standard_LRS" },
                    properties: { accessTier: "Hot" },
                }],
            }),
        });
        queryMock.mockResolvedValue([METER_ROWS, []]);

        const first = await (await GET(makeRequest())).json();
        const second = await (await GET(makeRequest())).json();

        expect(first.accounts[0].usedGb).toBe(5);
        expect(second.accounts[0].usedGb).toBe(5);
        expect(second.totalGb).toBe(first.totalGb);
        expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO CostMeterSnapshots"))).toBe(false);
    });

    it("preserva valores live distintos, incluido cero, y marca telemetría ausente", async () => {
        const gigabyte = 1024 * 1024 * 1024;
        vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            if (url.includes("/subscriptions?")) {
                return new Response(JSON.stringify({ value: [{ subscriptionId: "sub-1" }] }), { status: 200 });
            }
            if (url.includes("storageone")) {
                return new Response(JSON.stringify({
                    value: [{ timeseries: [{ data: [
                        { timeStamp: "2026-08-01T00:00:00Z", average: 2 * gigabyte },
                        { timeStamp: "2026-08-01T01:00:00Z", average: 3 * gigabyte },
                        { timeStamp: "2026-08-01T02:00:00Z", average: null },
                    ] }] }],
                }), { status: 200 });
            }
            if (url.includes("storagezero")) {
                return new Response(JSON.stringify({
                    value: [{ timeseries: [{ data: [{ timeStamp: "2026-08-01T01:00:00Z", average: 0 }] }] }],
                }), { status: 200 });
            }
            return new Response(JSON.stringify({ value: [{ timeseries: [{ data: [] }] }] }), { status: 200 });
        }));
        getResourceGraphClientMock.mockResolvedValue({
            resources: vi.fn().mockResolvedValue({
                data: ["storageone", "storagezero", "storagenometric"].map((name) => ({
                    id: `/subscriptions/sub-1/resourceGroups/rg-storage/providers/Microsoft.Storage/storageAccounts/${name}`,
                    name,
                    resourceGroup: "rg-storage",
                    subscriptionId: "sub-1",
                    location: "eastus",
                    sku: { name: "Standard_LRS" },
                    properties: { accessTier: "Hot" },
                })),
            }),
        });
        queryMock.mockResolvedValue([[], []]);

        const body = await (await GET(makeRequest())).json();

        expect(body.accounts.map((account: any) => account.usedGb)).toEqual([3, 0, null]);
        expect(body.accounts.map((account: any) => account.capacitySource)).toEqual([
            "azure-monitor",
            "azure-monitor",
            "unavailable",
        ]);
        expect(body.accounts[0].capacityUpdatedAt).toBe("2026-08-01T01:00:00Z");
        expect(body.totalGb).toBe(3);
    });
});

describe("insertCostMeterSnapshotRow", () => {
    beforeEach(() => {
        poolQueryMock.mockReset();
        poolQueryMock.mockResolvedValue([[], []]);
    });

    it("escribe en CostMeterSnapshots normalizando meter fields y región a '' (clave única sin NULLs)", async () => {
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
        // meterCategory / meterSubCategory / meterName / resource_location
        // ausentes → '' (no NULL, porque integran la unique key)
        expect(params).toEqual([
            "t1", "sub-1", "2026-07-03", "Storage",
            "", "", "", "",
            12.34, null, null,
        ]);
    });

    it("persiste resource_location cuando viene informado (región para compute)", async () => {
        const { insertCostMeterSnapshotRow } =
            await vi.importActual<typeof import("@/modules/storage/db")>("@/modules/storage/db");
        await insertCostMeterSnapshotRow("t1", "2026-07-03", {
            subscriptionId: "sub-1",
            serviceName: "Virtual Machines",
            meterName: "D4s v5",
            meterSubCategory: "D4s v5",
            resourceLocation: "us east",
            cost: 20,
        });

        const [, params] = poolQueryMock.mock.calls[0];
        // orden: tenant, sub, date, service, cat, subcat, meter, LOCATION, cost, qty, uom
        expect(params[7]).toBe("us east");
    });
});
