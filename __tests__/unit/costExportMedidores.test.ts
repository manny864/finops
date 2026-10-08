import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock, meterMock, listMock, downloadMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    meterMock: vi.fn(),
    listMock: vi.fn(),
    downloadMock: vi.fn(),
}));
vi.mock("@/lib/azureBlobStorage", () => ({
    isBlobStorageEnabled: () => true,
    listBlobs: listMock,
    downloadBlob: downloadMock,
}));
vi.mock("@/modules/storage/db", () => ({ default: { query: queryMock }, insertCostMeterSnapshotRow: meterMock }));

import { ingestCostExportsForTenant } from "@/services/costExportIngestionService";

const RUN_A = "focus-cost-data/t1/miexport/20260901-20260930/run-aaa";
const RUN_B = "focus-cost-data/t1/miexport/20260901-20260930/run-bbb";

function exportCon(archivos: Record<string, string>) {
    listMock.mockResolvedValue(Object.keys(archivos));
    downloadMock.mockImplementation(async (_c: string, name: string) => Buffer.from(archivos[name]));
}
const filasMedidor = () => meterMock.mock.calls.map(([, date, row]) => ({ date, ...row }));

beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockResolvedValue([[]]);
});

// MEJ-42 punto 3: sin esto, la causa raíz de un tenant que ingiere por export
// decía "Sin detalle por medidor" en cada anomalía.
describe("ingesta del export: detalle por medidor", () => {
    it("FOCUS: suma costo y cantidad por servicio, medidor y región, con la clave del sync por API", async () => {
        exportCon({
            [`${RUN_A}/part0.csv`]:
                `BilledCost,ChargePeriodStart,ConsumedQuantity,ConsumedUnit,RegionId,ServiceName,SkuMeter,SubscriptionId,x_ResourceGroupName,x_SkuMeterCategory\n` +
                `10,2026-09-01T00:00:00Z,24,1 Hour,eastus,Virtual Machines,D2s v3,sub-1,rg-a,Virtual Machines\n` +
                `5,2026-09-01T00:00:00Z,12,1 Hour,eastus,Virtual Machines,D2s v3,sub-1,rg-b,Virtual Machines\n` +
                `0.0004,2026-09-01T00:00:00Z,3,1 Hour,westus,Virtual Machines,D2s v3,sub-1,rg-a,Virtual Machines\n` +
                `2,2026-09-01T00:00:00Z,100,1 GB/Month,eastus,Storage,P10 LRS Disk,sub-1,rg-a,Storage\n` +
                `0,2026-09-01T00:00:00Z,999,1 Hour,eastus,Virtual Machines,D2s v3,sub-1,rg-a,Virtual Machines\n`,
        });

        const res = await ingestCostExportsForTenant("t1");

        expect(res.success).toBe(true);
        // CostSnapshots sigue agregando por resource group: el medidor no lo parte.
        expect(res.rowsIngested).toBe(3);
        const filas = filasMedidor();
        expect(filas).toHaveLength(3);
        expect(filas).toContainEqual({
            date: "2026-09-01",
            subscriptionId: "sub-1",
            serviceName: "Virtual Machines",
            meterCategory: "Virtual Machines",
            meterSubCategory: "D2s v3",
            meterName: "D2s v3",
            resourceLocation: "eastus",
            cost: 15,
            quantity: 36,
            unitOfMeasure: "1 Hour",
        });
        // Los centavos de un medidor chico no se redondean a cero.
        expect(filas.find(f => f.resourceLocation === "westus")?.cost).toBe(0.0004);
        expect(filas.find(f => f.serviceName === "Storage")).toMatchObject({ meterName: "P10 LRS Disk", quantity: 100 });
    });

    it("legacy: lee MeterName, Quantity, UnitOfMeasure y ResourceLocation", async () => {
        exportCon({
            [`${RUN_A}/part0.csv`]:
                `Date,SubscriptionId,ResourceGroup,ConsumedService,MeterCategory,MeterName,Quantity,UnitOfMeasure,ResourceLocation,CostInBillingCurrency\n` +
                `2026-09-02,sub-1,rg-a,Microsoft.Compute,Virtual Machines,D4s v3,10,1 Hour,EastUS,8\n` +
                `2026-09-02,sub-1,rg-a,Microsoft.Compute,Virtual Machines,D4s v3,5,1 Hour,EastUS,4\n`,
        });

        await ingestCostExportsForTenant("t1");

        expect(filasMedidor()).toEqual([{
            date: "2026-09-02",
            subscriptionId: "sub-1",
            serviceName: "Microsoft.Compute",
            meterCategory: "Virtual Machines",
            meterSubCategory: "D4s v3",
            meterName: "D4s v3",
            resourceLocation: "EastUS",
            cost: 12,
            quantity: 15,
            unitOfMeasure: "1 Hour",
        }]);
    });

    it("sin columna de medidor no escribe detalle", async () => {
        exportCon({
            [`${RUN_A}/part0.csv`]: `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost\n2026-09-01,sub-1,rg-a,Virtual Machines,10\n`,
        });
        const res = await ingestCostExportsForTenant("t1");
        expect(res.rowsIngested).toBe(1);
        expect(meterMock).not.toHaveBeenCalled();
    });

    it("las particiones de una corrida se suman; dos corridas del mismo mes no", async () => {
        const encabezado = `BilledCost,ChargePeriodStart,ConsumedQuantity,ServiceName,SkuMeter,SubscriptionId\n`;
        exportCon({
            [`${RUN_A}/part0.csv`]: encabezado + `10,2026-09-01,1,Virtual Machines,D2s v3,sub-1\n`,
            [`${RUN_A}/part1.csv`]: encabezado + `20,2026-09-01,2,Virtual Machines,D2s v3,sub-1\n`,
            // Azure reexpone el mes en cada corrida: la segunda trae el total, no un delta.
            [`${RUN_B}/part0.csv`]: encabezado + `30,2026-09-01,3,Virtual Machines,D2s v3,sub-1\n`,
        });

        await ingestCostExportsForTenant("t1");

        expect(filasMedidor().map(f => [f.cost, f.quantity])).toEqual([[30, 3], [30, 3]]);
    });
});
