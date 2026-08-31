import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/azureBlobStorage", () => ({
    isBlobStorageEnabled: vi.fn(),
    listBlobs: vi.fn(),
    downloadBlob: vi.fn(),
}));
vi.mock("@/modules/storage/db", () => ({ default: { query: vi.fn() } }));

import { ingestCostExportsForTenant, splitCsvLine, parseExportTags } from "@/services/costExportIngestionService";
import * as azureBlob from "@/lib/azureBlobStorage";
import pool from "@/modules/storage/db";

describe("splitCsvLine — respeta las comillas", () => {
    it("no parte un campo entrecomillado que tiene comas adentro", () => {
        // El caso que rompía todo: la columna de tags de Azure.
        const linea = `2026-08-14,sub-1,rg-a,Storage,"{""env"":""prod"",""owner"":""ana""}",42.50`;
        const cols = splitCsvLine(linea);

        expect(cols).toHaveLength(6);
        expect(cols[4]).toBe('{"env":"prod","owner":"ana"}');
        // Lo decisivo: el costo sigue en su posición y no se corrió.
        expect(cols[5]).toBe("42.50");
    });

    it("desescapa las comillas dobles ('' -> ')", () => {
        expect(splitCsvLine('a,"di""jo"',)[1]).toBe('di"jo');
    });

    it("un campo vacío sigue siendo un campo", () => {
        expect(splitCsvLine("a,,c")).toEqual(["a", "", "c"]);
    });
});

describe("parseExportTags — normaliza a JSON válido", () => {
    it("acepta el JSON completo de FOCUS", () => {
        expect(parseExportTags('{"env":"prod"}')).toBe('{"env":"prod"}');
    });

    it("acepta los pares sin llaves de los exports legacy", () => {
        expect(parseExportTags('"env": "prod","owner": "ana"')).toBe('{"env":"prod","owner":"ana"}');
    });

    it("devuelve null ante vacío, basura o un objeto sin claves", () => {
        // Escribir basura en una columna JSON haría que MySQL rechace el INSERT
        // entero y se pierda el costo de la fila.
        expect(parseExportTags("")).toBeNull();
        expect(parseExportTags(undefined)).toBeNull();
        expect(parseExportTags("no soy json")).toBeNull();
        expect(parseExportTags("{}")).toBeNull();
        expect(parseExportTags('["a","b"]')).toBeNull();
    });
});

describe("ingestCostExportsForTenant — persiste Tags y ResourceId (MEJ-30)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(azureBlob.isBlobStorageEnabled).mockReturnValue(true);
        vi.mocked(azureBlob.listBlobs).mockResolvedValue(["focus/export.csv"]);
    });

    it("guarda las etiquetas y el id del recurso, que antes se descartaban", async () => {
        const csv =
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,ResourceId,Tags,BilledCost\n` +
            `2026-08-14,sub-1,rg-a,Storage,/subscriptions/sub-1/rg-a/sa1,"{""CostCenter"":""IT"",""env"":""prod""}",42.50\n`;
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from(csv));

        const res = await ingestCostExportsForTenant("t1");

        expect(res.rowsIngested).toBe(1);
        const [sql, params] = vi.mocked(pool.query).mock.calls[0] as any;
        expect(String(sql)).toContain("Tags");
        expect(String(sql)).toContain("ResourceId");
        expect(params).toContain('{"CostCenter":"IT","env":"prod"}');
        expect(params).toContain("/subscriptions/sub-1/rg-a/sa1");
        // El costo no se corrió pese a las comas dentro de los tags.
        expect(params).toContain(42.5);
    });

    it("un export sin esas columnas sigue funcionando y no inventa datos", async () => {
        const csv =
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost\n` +
            `2026-08-14,sub-1,rg-a,Storage,10.25\n`;
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from(csv));

        const res = await ingestCostExportsForTenant("t1");

        expect(res.rowsIngested).toBe(1);
        const [, params] = vi.mocked(pool.query).mock.calls[0] as any;
        // Tags y ResourceId van null: el COALESCE del UPDATE evita que una
        // re-ingesta sin tags borre los que ya estaban guardados.
        expect(params[params.length - 2]).toBeNull();
        expect(params[params.length - 1]).toBeNull();
    });
});
