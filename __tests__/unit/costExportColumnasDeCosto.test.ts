import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/azureBlobStorage", () => ({
    isBlobStorageEnabled: vi.fn(),
    listBlobs: vi.fn(),
    downloadBlob: vi.fn(),
}));
vi.mock("@/modules/storage/db", () => ({ default: { query: vi.fn() } }));

import { ingestCostExportsForTenant } from "@/services/costExportIngestionService";
import * as azureBlob from "@/lib/azureBlobStorage";
import pool from "@/modules/storage/db";

/** Orden del INSERT: ..., cost_usd, BilledCost, EffectiveCost, ListCost, ContractedCost, Tags, ResourceId */
const COSTO = 5, FACTURADO = 6, EFECTIVO = 7, LISTA = 8, CONTRATADO = 9;

function paramsDelInsert() {
    const [, params] = vi.mocked(pool.query).mock.calls[0] as any;
    return params as any[];
}

describe("ingesta del export: cada costo a su columna (MEJ-40)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(azureBlob.isBlobStorageEnabled).mockReturnValue(true);
        vi.mocked(azureBlob.listBlobs).mockResolvedValue(["focus/export.csv"]);
    });

    it("no mete BilledCost dentro de EffectiveCost", async () => {
        // El bug: las columnas se buscaban con includes("cost") y la primera que
        // contiene la palabra en un export FOCUS es BilledCost. Ese número se
        // escribía TAMBIÉN en EffectiveCost, así que las dos quedaban iguales y
        // el descuento por compromiso —lo único que las separa— desaparecía.
        const csv =
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost,EffectiveCost,ListCost,ContractedCost\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,100,70,120,110\n`;
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from(csv));

        await ingestCostExportsForTenant("t1");
        const p = paramsDelInsert();

        expect(p[FACTURADO]).toBe(100);
        expect(p[EFECTIVO]).toBe(70);
        expect(p[LISTA]).toBe(120);
        expect(p[CONTRATADO]).toBe(110);
        expect(p[EFECTIVO]).not.toBe(p[FACTURADO]);
    });

    it("cost_usd sigue siendo el mismo valor de antes", async () => {
        // Lo que suma todo el producto no se mueve con este cambio: en un
        // export FOCUS era BilledCost y sigue siéndolo. Si cambiara, todos los
        // tableros cambiarían de número sin que nadie lo pidiera.
        const csv =
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost,EffectiveCost,ListCost\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,100,70,120\n`;
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from(csv));

        await ingestCostExportsForTenant("t1");
        expect(paramsDelInsert()[COSTO]).toBe(100);
    });

    it("sin columna de precio de lista guarda null, no cero", async () => {
        // Un 0 acá se leería como "100% de descuento" al promediar el ESR.
        const csv =
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost,EffectiveCost\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,100,70\n`;
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from(csv));

        await ingestCostExportsForTenant("t1");
        const p = paramsDelInsert();

        expect(p[LISTA]).toBeNull();
        expect(p[CONTRATADO]).toBeNull();
        expect(p[EFECTIVO]).toBe(70);
    });

    it("una celda vacía tampoco es cero", async () => {
        const csv =
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost,EffectiveCost,ListCost\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,100,70,\n`;
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from(csv));

        await ingestCostExportsForTenant("t1");
        expect(paramsDelInsert()[LISTA]).toBeNull();
    });

    it("un export legacy sin esas columnas sigue entrando", async () => {
        // Los exports viejos no traen ni ListCost ni EffectiveCost. No se
        // rechazan: entran con lo que tienen y quedan fuera del ESR.
        const csv =
            `UsageDateTime,SubscriptionId,ResourceGroup,ServiceName,Cost\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,42.5\n`;
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from(csv));

        const res = await ingestCostExportsForTenant("t1");
        const p = paramsDelInsert();

        expect(res.rowsIngested).toBe(1);
        expect(p[COSTO]).toBe(42.5);
        expect(p[EFECTIVO]).toBe(42.5);
        expect(p[LISTA]).toBeNull();
    });
});
