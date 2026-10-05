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
import { allocationKey, hashAllocationKey } from "@/lib/allocationTags";
import { gzipSync } from "zlib";

/** Orden del INSERT: ..., cost_usd, BilledCost, EffectiveCost, ListCost, ContractedCost, Tags, ResourceId, allocation_tag_hash */
const FECHA = 2, RG = 3, SERVICIO = 4, COSTO = 5, FACTURADO = 6, EFECTIVO = 7;
const LISTA = 8, CONTRATADO = 9, TAGS = 10, RESOURCE_ID = 11, HASH = 12;

/** Los parámetros de cada INSERT que se ejecutó, en orden. */
function inserts(): any[][] {
    return vi.mocked(pool.query).mock.calls.map(([, params]) => params as any[]);
}

/** Carpeta de una ejecución real: `.../NombreExport/[período]/[RunID]/parteN.csv` */
const RUN_A = "focus-cost-data/t1/miexport/20260901-20260930/run-aaa";
const RUN_B = "focus-cost-data/t1/miexport/20260901-20260930/run-bbb";

describe("ingesta del export: el costo se SUMA, no se pisa", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(azureBlob.isBlobStorageEnabled).mockReturnValue(true);
        vi.mocked(pool.query).mockResolvedValue([[]] as any);
    });

    it("suma las líneas que comparten (fecha, resource group, servicio)", async () => {
        // El export es a nivel de línea: un renglón por recurso, por medidor y
        // por día. Todos estos caen en la MISMA clave única de CostSnapshots.
        // El upsert de antes los pisaba uno a uno y sobrevivía sólo el último,
        // así que el tenant veía 5 de sus 100 dólares.
        const csv =
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost,EffectiveCost\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,10,8\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,25,20\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,60,55\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,5,4\n`;
        vi.mocked(azureBlob.listBlobs).mockResolvedValue([`${RUN_A}/part0.csv`]);
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from(csv));

        const res = await ingestCostExportsForTenant("t1");
        const filas = inserts();

        expect(filas).toHaveLength(1);
        expect(res.rowsIngested).toBe(1);
        expect(filas[0][COSTO]).toBe(100);
        expect(filas[0][FACTURADO]).toBe(100);
        expect(filas[0][EFECTIVO]).toBe(87);
        // El último valor suelto, que era lo único que sobrevivía antes.
        expect(filas[0][COSTO]).not.toBe(5);
    });

    it("no mezcla claves distintas", async () => {
        const csv =
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,10\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,20\n` +
            `2026-09-01,sub-1,rg-a,Storage,7\n` +
            `2026-09-02,sub-1,rg-a,Virtual Machines,3\n` +
            `2026-09-01,sub-1,rg-b,Virtual Machines,1\n`;
        vi.mocked(azureBlob.listBlobs).mockResolvedValue([`${RUN_A}/part0.csv`]);
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from(csv));

        const filas = (await ingestCostExportsForTenant("t1"), inserts());
        expect(filas).toHaveLength(4);

        const buscar = (fecha: string, rg: string, srv: string) =>
            filas.find(f => f[FECHA] === fecha && f[RG] === rg && f[SERVICIO] === srv);

        expect(buscar("2026-09-01", "rg-a", "Virtual Machines")![COSTO]).toBe(30);
        expect(buscar("2026-09-01", "rg-a", "Storage")![COSTO]).toBe(7);
        expect(buscar("2026-09-02", "rg-a", "Virtual Machines")![COSTO]).toBe(3);
        expect(buscar("2026-09-01", "rg-b", "Virtual Machines")![COSTO]).toBe(1);
    });

    it("una segunda ingesta del mismo contenido no duplica el total", async () => {
        // Azure reexpone el mes en curso en cada ejecución. Correr lo mismo dos
        // veces tiene que DEJAR el total, no sumarlo de nuevo: la agregación es
        // en memoria y el UPDATE pisa con el total del período.
        const csv =
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,10\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,25\n`;
        vi.mocked(azureBlob.listBlobs).mockResolvedValue([`${RUN_A}/part0.csv`]);
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from(csv));

        await ingestCostExportsForTenant("t1");
        const primera = inserts();
        vi.mocked(pool.query).mockClear();

        await ingestCostExportsForTenant("t1");
        const segunda = inserts();

        expect(primera).toHaveLength(1);
        expect(segunda).toHaveLength(1);
        expect(primera[0][COSTO]).toBe(35);
        expect(segunda[0][COSTO]).toBe(35);

        // Y lo que se manda es un UPDATE que PISA el costo, no que lo acumula:
        // si dijera `cost_usd = cost_usd + VALUES(...)`, mandar 35 dos veces
        // dejaría 70 en la base aunque el parámetro sea el mismo.
        const [sql] = vi.mocked(pool.query).mock.calls[0] as any;
        expect(sql).toContain("cost_usd = VALUES(cost_usd)");
        expect(sql).not.toMatch(/cost_usd\s*=\s*cost_usd\s*\+/);
    });

    it("suma todas las particiones de una misma ejecución", async () => {
        // El particionado está siempre activo y no se puede desactivar: el
        // dataset de una ejecución vive repartido en varias partes de la misma
        // carpeta. Tratar cada parte por separado dejaría sólo la última.
        const parte = (costo: string) =>
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,${costo}\n`;
        vi.mocked(azureBlob.listBlobs).mockResolvedValue([
            `${RUN_A}/part0.csv`, `${RUN_A}/part1.csv`, `${RUN_A}/part2.csv`,
        ]);
        vi.mocked(azureBlob.downloadBlob)
            .mockResolvedValueOnce(Buffer.from(parte("10")))
            .mockResolvedValueOnce(Buffer.from(parte("20")))
            .mockResolvedValueOnce(Buffer.from(parte("30")));

        const filas = (await ingestCostExportsForTenant("t1"), inserts());
        expect(filas).toHaveLength(1);
        expect(filas[0][COSTO]).toBe(60);
    });

    it("dos ejecuciones del mismo período no se suman entre sí", async () => {
        // Con "Overwrite data" apagado queda un RunID por día, y cada uno
        // reexpone el mes ENTERO. Sumarlos multiplicaría el mes por la cantidad
        // de corridas. Cada ejecución pisa a la anterior; gana la última.
        const corrida = (costo: string) =>
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,${costo}\n`;
        vi.mocked(azureBlob.listBlobs).mockResolvedValue([
            `${RUN_A}/part0.csv`, `${RUN_B}/part0.csv`,
        ]);
        vi.mocked(azureBlob.downloadBlob)
            .mockResolvedValueOnce(Buffer.from(corrida("40")))
            .mockResolvedValueOnce(Buffer.from(corrida("45")));

        const filas = (await ingestCostExportsForTenant("t1"), inserts());
        expect(filas).toHaveLength(2);
        expect(filas[0][COSTO]).toBe(40);
        expect(filas[1][COSTO]).toBe(45);
        // Lo que NO puede pasar: una sola fila con los dos meses sumados.
        expect(filas.some(f => f[COSTO] === 85)).toBe(false);
    });

    it("los recursos etiquetados no colapsan en el cubo sin asignar", async () => {
        // allocation_tag_hash entra en la clave única. Sin setearlo, todo caía
        // en '' y dos centros de costo distintos terminaban en la misma fila.
        const csv =
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost,Tags\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,10,"{""CostCenter"":""CC-1""}"\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,20,"{""CostCenter"":""CC-1""}"\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,7,"{""CostCenter"":""CC-2""}"\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,5,\n`;
        vi.mocked(azureBlob.listBlobs).mockResolvedValue([`${RUN_A}/part0.csv`]);
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from(csv));

        const filas = (await ingestCostExportsForTenant("t1"), inserts());
        expect(filas).toHaveLength(3);

        const porHash = (tags: unknown) =>
            filas.find(f => f[HASH] === hashAllocationKey(allocationKey(tags)));

        expect(porHash({ CostCenter: "CC-1" })![COSTO]).toBe(30);
        expect(porHash({ CostCenter: "CC-2" })![COSTO]).toBe(7);
        expect(porHash(null)![COSTO]).toBe(5);
        expect(porHash(null)![HASH]).toBe("");
        expect(porHash({ CostCenter: "CC-1" })![TAGS]).toBe(JSON.stringify({ CostCenter: "CC-1" }));
    });

    it("un precio de lista parcial queda en null, no en una suma incompleta", async () => {
        // Si sólo una de las dos líneas trae ListCost, sumar sólo esa daría un
        // precio de lista MENOR que el efectivo del grupo y el ESR leería un
        // descuento inventado. null = "no lo sabemos", y queda fuera del ESR.
        const csv =
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost,EffectiveCost,ListCost\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,10,10,30\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,90,90,\n`;
        vi.mocked(azureBlob.listBlobs).mockResolvedValue([`${RUN_A}/part0.csv`]);
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from(csv));

        const filas = (await ingestCostExportsForTenant("t1"), inserts());
        expect(filas[0][COSTO]).toBe(100);
        expect(filas[0][LISTA]).toBeNull();
        expect(filas[0][CONTRATADO]).toBeNull();
    });

    it("con el precio de lista en todas las líneas, lo suma", async () => {
        const csv =
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost,EffectiveCost,ListCost,ContractedCost\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,10,8,30,20\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,90,70,120,100\n`;
        vi.mocked(azureBlob.listBlobs).mockResolvedValue([`${RUN_A}/part0.csv`]);
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from(csv));

        const filas = (await ingestCostExportsForTenant("t1"), inserts());
        expect(filas[0][EFECTIVO]).toBe(78);
        expect(filas[0][LISTA]).toBe(150);
        expect(filas[0][CONTRATADO]).toBe(120);
    });

    it("no le pone a la fila el id de uno solo de los recursos que sumó", async () => {
        const csv =
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost,ResourceId\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,10,/subs/1/vm-a\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,20,/subs/1/vm-b\n` +
            `2026-09-01,sub-1,rg-b,Virtual Machines,5,/subs/1/vm-c\n`;
        vi.mocked(azureBlob.listBlobs).mockResolvedValue([`${RUN_A}/part0.csv`]);
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from(csv));

        const filas = (await ingestCostExportsForTenant("t1"), inserts());
        const variosRecursos = filas.find(f => f[RG] === "rg-a")!;
        const unSoloRecurso = filas.find(f => f[RG] === "rg-b")!;

        expect(variosRecursos[COSTO]).toBe(30);
        expect(variosRecursos[RESOURCE_ID]).toBeNull();
        expect(unSoloRecurso[RESOURCE_ID]).toBe("/subs/1/vm-c");
    });

    it("suma centavos sin arrastrar el error del punto flotante", async () => {
        const csv =
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,0.1\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,0.2\n`;
        vi.mocked(azureBlob.listBlobs).mockResolvedValue([`${RUN_A}/part0.csv`]);
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from(csv));

        const filas = (await ingestCostExportsForTenant("t1"), inserts());
        expect(filas[0][COSTO]).toBe(0.3);
    });

    it("el manifiesto de la ejecución no se lee como si fuera datos", async () => {
        const csv =
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,10\n`;
        vi.mocked(azureBlob.listBlobs).mockResolvedValue([
            `${RUN_A}/manifest.json`, `${RUN_A}/part0.csv`,
        ]);
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from(csv));

        await ingestCostExportsForTenant("t1");
        expect(vi.mocked(azureBlob.downloadBlob)).toHaveBeenCalledTimes(1);
        expect(inserts()).toHaveLength(1);
    });
    it("conserva las etiquetas comunes al grupo y tira las que difieren", async () => {
        // Un Cost Group puede filtrar por CUALQUIER clave de tag, no sólo por
        // las de asignación, así que la clave propia (`BillingCode`) tiene que
        // sobrevivir. `Name`, en cambio, es distinto en cada recurso: dejar el
        // de una de las líneas afirmaría que la fila entera es ese recurso.
        const csv =
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost,Tags\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,10,"{""CostCenter"":""CC-1"",""BillingCode"":""B7"",""Name"":""vm-a""}"\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,20,"{""CostCenter"":""CC-1"",""BillingCode"":""B7"",""Name"":""vm-b""}"\n`;
        vi.mocked(azureBlob.listBlobs).mockResolvedValue([`${RUN_A}/part0.csv`]);
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from(csv));

        const filas = (await ingestCostExportsForTenant("t1"), inserts());
        expect(filas).toHaveLength(1);
        expect(filas[0][COSTO]).toBe(30);

        const tags = JSON.parse(filas[0][TAGS]);
        expect(tags.BillingCode).toBe("B7");
        expect(tags.CostCenter).toBe("CC-1");
        expect(tags).not.toHaveProperty("Name");
    });

    it("si ninguna etiqueta es común al grupo, Tags va null", async () => {
        const csv =
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost,Tags\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,10,"{""Name"":""vm-a""}"\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,20,"{""Name"":""vm-b""}"\n`;
        vi.mocked(azureBlob.listBlobs).mockResolvedValue([`${RUN_A}/part0.csv`]);
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from(csv));

        const filas = (await ingestCostExportsForTenant("t1"), inserts());
        expect(filas[0][COSTO]).toBe(30);
        expect(filas[0][TAGS]).toBeNull();
    });
    it("lee un export comprimido con Gzip", async () => {
        // Gzip es una de las dos compresiones que el export ofrece para CSV, y
        // el filtro de blobs ya aceptaba .csv.gz — pero el contenido se leía
        // como UTF-8 plano. El resultado era binario, no matcheaba ninguna
        // columna de costo y el blob se descartaba sin error: un tenant con el
        // export comprimido veía cero gasto.
        const csv =
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,10\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,20\n`;
        vi.mocked(azureBlob.listBlobs).mockResolvedValue([`${RUN_A}/part0.csv.gz`]);
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(gzipSync(Buffer.from(csv)));

        const res = await ingestCostExportsForTenant("t1");
        const filas = inserts();

        expect(res.rowsIngested).toBe(1);
        expect(filas).toHaveLength(1);
        expect(filas[0][COSTO]).toBe(30);
    });

    it("mezcla particiones comprimidas y sin comprimir en la misma corrida", async () => {
        const csv = (costo: string) =>
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,${costo}\n`;
        vi.mocked(azureBlob.listBlobs).mockResolvedValue([
            `${RUN_A}/part0.csv.gz`, `${RUN_A}/part1.csv`,
        ]);
        vi.mocked(azureBlob.downloadBlob)
            .mockResolvedValueOnce(gzipSync(Buffer.from(csv("10"))))
            .mockResolvedValueOnce(Buffer.from(csv("20")));

        const filas = (await ingestCostExportsForTenant("t1"), inserts());
        expect(filas).toHaveLength(1);
        expect(filas[0][COSTO]).toBe(30);
    });

    it("un .gz corrupto se omite pero no tumba el resto de la corrida", async () => {
        // Antes el blob ilegible se descartaba en silencio. Ahora se avisa —
        // pero sigue sin poder cancelar la ingesta de las demás particiones,
        // que son perfectamente válidas.
        const csv =
            `ChargePeriodStart,SubscriptionId,ResourceGroup,ServiceName,BilledCost\n` +
            `2026-09-01,sub-1,rg-a,Virtual Machines,20\n`;
        vi.mocked(azureBlob.listBlobs).mockResolvedValue([
            `${RUN_A}/part0.csv.gz`, `${RUN_A}/part1.csv`,
        ]);
        vi.mocked(azureBlob.downloadBlob)
            .mockResolvedValueOnce(Buffer.from("esto no es un gzip"))
            .mockResolvedValueOnce(Buffer.from(csv));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const res = await ingestCostExportsForTenant("t1");
        const filas = inserts();

        expect(res.success).toBe(true);
        expect(filas).toHaveLength(1);
        expect(filas[0][COSTO]).toBe(20);
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("No se pudo descomprimir"),
            expect.anything(),
        );
        warn.mockRestore();
    });

    it("avisa cuando no reconoce ninguna columna de costo, en vez de callarse", async () => {
        // El silencio de este camino es lo que escondió el bug del .gz: el blob
        // se descartaba sin dejar rastro y parecía un tenant sin gasto.
        vi.mocked(azureBlob.listBlobs).mockResolvedValue([`${RUN_A}/part0.csv`]);
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(
            Buffer.from("columna_a,columna_b\nvalor,otro\n"));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const res = await ingestCostExportsForTenant("t1");

        expect(res.rowsIngested).toBe(0);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("ninguna columna de costo"));
        warn.mockRestore();
    });
});

describe("ingesta del export: cada tenant lee sólo su carpeta", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(azureBlob.isBlobStorageEnabled).mockReturnValue(true);
        vi.mocked(pool.query).mockResolvedValue([[]] as any);
    });

    it("sin archivos propios no cae a la carpeta compartida", async () => {
        // Antes, una carpeta vacía disparaba un listado de `focus-cost-data/`
        // entero y los costos de otro tenant se guardaban con este tenant_id.
        vi.mocked(azureBlob.listBlobs).mockImplementation(async (_c: string, prefix?: string) =>
            prefix === "focus-cost-data/t1/" ? [] : ["focus-cost-data/otro/miexport/20260901-20260930/run-x/part0.csv"]);
        vi.mocked(azureBlob.downloadBlob).mockResolvedValue(Buffer.from("Date,BilledCost\n2026-09-01,10\n"));

        const res = await ingestCostExportsForTenant("t1");

        expect(vi.mocked(azureBlob.listBlobs).mock.calls.map(([, prefix]) => prefix)).toEqual(["focus-cost-data/t1/"]);
        expect(res.rowsIngested).toBe(0);
        expect(pool.query).not.toHaveBeenCalled();
    });
});
