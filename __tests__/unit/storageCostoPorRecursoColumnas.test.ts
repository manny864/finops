// @vitest-environment node
/**
 * Las rutas de Discos, Data Lake Gen2 y Backups tienen que poder leer el costo por recurso.
 *
 * Pedían `resource_id` y `resource_group` a CostCategorySnapshots. Esa tabla guarda una fila por (suscripción, día,
 * `resource_type`): no tiene recurso ni grupo. MySQL rechazaba la consulta entera y el `.catch(() => [[], []])` la
 * volvía vacía, así que los discos y los vaults caían a su estimación por lista de precios y las cuentas de Data Lake
 * salían siempre en 0.
 *
 * El costo por recurso sólo está en CostSnapshots.ResourceId (y sólo en las filas de un único recurso:
 * costExportIngestionService). Las rutas apuntan ahí. El costo "por grupo" se va: asignaba el TOTAL del grupo a cada
 * recurso sin dato propio, es decir N veces el costo real con N recursos en el grupo, y nunca se notó porque la
 * consulta no corría.
 *
 * Los mocks de `pool.query` aceptan cualquier SELECT. Acá la base falsa lee el DDL REAL del repo y rechaza, como MySQL,
 * toda tabla o columna inexistente.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { crearBaseFalsa } from "../helpers/baseFalsaDdl";
import { conProyeccion } from "../helpers/proyeccionSelect";

const { query, discos, cuentas, vaults } = vi.hoisted(() => ({ query: vi.fn(), discos: vi.fn(), cuentas: vi.fn(), vaults: vi.fn() }));

vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => query(...a) } }));
vi.mock("@/lib/requestAuth", async () => ({ ...(await vi.importActual<object>("@/lib/requestAuth")), requireTenantAccess: async () => {} }));
vi.mock("@/lib/azure", () => ({ getSubscriptionsForTenant: vi.fn(async () => ["sub-1"]) }));
vi.mock("@/lib/cache", () => ({ getWithStaleWhileRevalidate: async (_clave: string, f: () => unknown) => f() }));
vi.mock("@/services/managedDisks.service", async () => ({
    ...(await vi.importActual<object>("@/services/managedDisks.service")),
    fetchAllManagedDisksFromARG: (...a: unknown[]) => discos(...a),
    fetchDiskMetricsBatch: async () => new Map(),
}));
vi.mock("@/services/azureDataLakeGen2.service", async () => ({
    ...(await vi.importActual<object>("@/services/azureDataLakeGen2.service")),
    fetchAllDataLakeAccountsFromARG: (...a: unknown[]) => cuentas(...a),
}));
vi.mock("@/services/azureBackups.service", async () => ({
    ...(await vi.importActual<object>("@/services/azureBackups.service")),
    fetchAllBackupVaultsFromARG: (...a: unknown[]) => vaults(...a),
    fetchAllProtectedItemsFromARG: async () => [],
    fetchAllAsrItemsFromARG: async () => [],
}));

const { GET: getDiscos } = await import("@/app/api/intelligence/storage/managed-disks/route");
const { GET: getDataLake } = await import("@/app/api/intelligence/storage/data-lake-gen2/route");
const { GET: getBackups } = await import("@/app/api/intelligence/storage/backups/route");
const { estimateMonthlyDiskCost } = await import("@/services/managedDisks.service");

const TENANT = "11111111-aaaa-4bbb-8ccc-222222222222"; // real: no matchea isMockTenant
const rid = (tipo: string, nombre: string) => `/subscriptions/sub-1/resourceGroups/rg-prod/providers/${tipo}/${nombre}`;
const pedido = (ruta: string) => new NextRequest(`http://localhost/api/intelligence/storage/${ruta}?tenantId=${TENANT}`);

const base = crearBaseFalsa();
let consolaError: ReturnType<typeof vi.spyOn>;

/** La base contesta lo que diga `filas` para CostSnapshots, verificando que el SELECT proyecte lo que la ruta lee. */
function conCostos(filas: Record<string, unknown>[]) {
    query.mockImplementation(base.query({ costsnapshots: (_p, sql) => conProyeccion(sql, filas, base.violaciones) }));
}
/** La fila que contesta la base: el id en minúsculas, como lo devuelve el SELECT (`LOWER(ResourceId) AS resource_id`). */
const costoDe = (recurso: { id: string }, costo: string) => ({ resource_id: recurso.id.toLowerCase(), cost: costo });

beforeEach(() => {
    vi.clearAllMocks();
    base.reiniciar();
    consolaError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => consolaError.mockRestore());

describe("Discos administrados", () => {
    const disco = (nombre: string) => ({
        id: rid("Microsoft.Compute/disks", nombre),
        name: nombre,
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        location: "eastus",
        sku: { name: "Premium_LRS", tier: "Premium" },
        properties: { diskSizeGB: 512, diskState: "Attached", osType: null },
        tags: {},
        managedBy: null,
    });

    it("el costo del disco sale de CostSnapshots.ResourceId; los demás, de la estimación, no del total del grupo", async () => {
        const conDato = disco("disk-con-dato");
        const sinDato = disco("disk-sin-dato"); // mismo grupo de recursos
        discos.mockResolvedValue([conDato, sinDato]);
        conCostos([costoDe(conDato, "88.40")]);

        const r = await (await getDiscos(pedido("managed-disks"))).json();

        expect(base.violaciones).toEqual([]);
        const porNombre = Object.fromEntries(r.disks.map((d: { name: string; monthlyCostUsd: number }) => [d.name, d.monthlyCostUsd]));
        expect(porNombre["disk-con-dato"]).toBe(88.4);
        // Antes (con la consulta funcionando) este disco habría recibido el total del grupo, 88,40.
        expect(porNombre["disk-sin-dato"]).toBe(Number(estimateMonthlyDiskCost("Premium_LRS", 512).toFixed(2)));
    });
});

describe("Data Lake Gen2", () => {
    const cuenta = (nombre: string) => ({
        id: rid("Microsoft.Storage/storageAccounts", nombre),
        name: nombre,
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        location: "eastus",
        sku: { name: "Standard_LRS", tier: "Standard" },
        kind: "StorageV2",
        properties: { isHnsEnabled: true, accessTier: "Hot" },
        tags: {},
    });

    it("el costo de la cuenta sale de CostSnapshots.ResourceId y la que no tiene dato queda en 0, no en el total del grupo", async () => {
        const conDato = cuenta("stlakeconfdato");
        const sinDato = cuenta("stlakesindato");
        cuentas.mockResolvedValue([conDato, sinDato]);
        conCostos([costoDe(conDato, "120.00")]);

        const r = await (await getDataLake(pedido("data-lake-gen2"))).json();

        expect(base.violaciones).toEqual([]);
        const porNombre = Object.fromEntries(r.accounts.map((a: { name: string; monthlyCostUsd: number }) => [a.name, a.monthlyCostUsd]));
        expect(porNombre["stlakeconfdato"]).toBe(120);
        expect(porNombre["stlakesindato"]).toBe(0);
    });
});

describe("Backups", () => {
    const vault = (nombre: string, tipo = "Microsoft.RecoveryServices/vaults") => ({
        id: rid(tipo, nombre),
        name: nombre,
        type: tipo.toLowerCase(),
        resourceGroup: "rg-prod",
        subscriptionId: "sub-1",
        location: "eastus",
        sku: { name: "RS0" },
        properties: {},
        tags: {},
    });

    it("el costo del vault sale de CostSnapshots.ResourceId, sea Recovery Services o Backup Vault", async () => {
        const rsv = vault("rsv-prod");
        const bv = vault("bv-prod", "Microsoft.DataProtection/backupVaults");
        const sinDato = vault("rsv-sin-dato");
        vaults.mockResolvedValue([rsv, bv, sinDato]);
        conCostos([costoDe(rsv, "61.30"), costoDe(bv, "17.25")]);

        const r = await (await getBackups(pedido("backups"))).json();

        expect(base.violaciones).toEqual([]);
        const porNombre = Object.fromEntries(r.vaults.map((v: { name: string; monthlyCostUsd: number }) => [v.name, v.monthlyCostUsd]));
        expect(porNombre["rsv-prod"]).toBe(61.3);
        expect(porNombre["bv-prod"]).toBe(17.25);
        // Sin ítems protegidos la estimación es 0: no hereda el costo de los otros vaults del grupo.
        expect(porNombre["rsv-sin-dato"]).toBe(0);
    });

    it("la consulta filtra por los dos tipos de vault, para no traer el costo de cualquier recurso del tenant", async () => {
        vaults.mockResolvedValue([vault("rsv-prod")]);
        conCostos([]);

        await getBackups(pedido("backups"));

        const sql = String(query.mock.calls.find(([s]) => /FROM\s+CostSnapshots/i.test(String(s)))?.[0]);
        expect(sql).toMatch(/microsoft\.recoveryservices\/vaults/i);
        expect(sql).toMatch(/microsoft\.dataprotection\/backupvaults/i);
    });
});
