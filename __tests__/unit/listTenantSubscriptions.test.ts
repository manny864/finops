import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * Un token emitido para el tenant A no devuelve solamente las suscripciones de
 * A: alcanza con que el service principal tenga RBAC sobre una suscripción de
 * otro directorio para que ARM la liste igual. Medido contra Azure real, el
 * token de "CS CloudSolutions Azure Patrocinio" devolvía una suscripción del
 * tenant vecino y la plataforma la mostraba como propia.
 *
 * Los casos de acá son el límite entre los dos clientes, así que ninguno es
 * decorativo: si uno se pone verde de más, hay datos de un cliente en la
 * pantalla de otro.
 */
vi.mock("@/modules/storage/db", () => ({
    default: { query: vi.fn().mockResolvedValue([[]]) },
    initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

const PROPIO = "81ebe027-e6af-4e09-bc73-58c9012c6408";
const AJENO = "8b41364f-581a-4e43-b7cb-13138dac5517";

const credFalsa = { getToken: async () => ({ token: "t" }) } as any;

function armResponde(subs: Array<Record<string, unknown>>) {
    vi.stubGlobal("fetch", vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ value: subs }),
    })));
}

async function listar() {
    const { listTenantSubscriptions } = await import("@/lib/azure");
    return listTenantSubscriptions(PROPIO, credFalsa);
}

afterEach(() => vi.unstubAllGlobals());

describe("listTenantSubscriptions", () => {
    it("descarta la suscripción de otro directorio y conserva la propia", async () => {
        armResponde([
            { subscriptionId: "0beb7800", displayName: "CSCloudSolution-Production", tenantId: AJENO },
            { subscriptionId: "ec03e8ce", displayName: "CSCS-LandingZone", tenantId: PROPIO },
        ]);
        expect((await listar()).map((s) => s.subscriptionId)).toEqual(["ec03e8ce"]);
    });

    it("una suscripción sin tenantId no se puede atribuir: no entra", async () => {
        armResponde([{ subscriptionId: "sin-duenio", displayName: "Huérfana" }]);
        expect(await listar()).toEqual([]);
    });

    it("compara sin distinguir mayúsculas: ARM no promete el casing del GUID", async () => {
        armResponde([{ subscriptionId: "a", tenantId: PROPIO.toUpperCase() }]);
        expect((await listar()).map((s) => s.subscriptionId)).toEqual(["a"]);
    });

    it("sin tenant pedido no devuelve nada, en vez de devolver todo", async () => {
        armResponde([{ subscriptionId: "a", tenantId: PROPIO }]);
        const { listTenantSubscriptions } = await import("@/lib/azure");
        expect(await listTenantSubscriptions("", credFalsa)).toEqual([]);
    });

    it("un 403 sube como AccessDenied: falta el rol de Lector, no faltan suscripciones", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })));
        await expect(listar()).rejects.toThrow(/AccessDenied/);
    });
});
