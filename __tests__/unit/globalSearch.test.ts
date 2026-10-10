// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * El tenant no es un filtro de conveniencia: es el limite de seguridad del
 * buscador. Un buscador global sin el `tenant_id` en el WHERE seria la forma
 * mas comoda de leer nombres de recursos, servicios y reglas de otro cliente.
 * Estos casos fijan eso y el escapado de los comodines de LIKE.
 */
const query = vi.fn();
vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => query(...a) } }));

// El origen `waste` no sale de MySQL (no existe tabla con el desperdicio): lee el escaneo de zombis que ya está en la
// caché. El escaneo vivo (`getActiveHardWaste`) está acá sólo para comprobar que el buscador NUNCA lo dispara.
const peekActiveHardWaste = vi.fn();
const getActiveHardWaste = vi.fn();
vi.mock("@/services/azureHardWaste.service", () => ({
    peekActiveHardWaste: (...a: unknown[]) => peekActiveHardWaste(...a),
    getActiveHardWaste: (...a: unknown[]) => getActiveHardWaste(...a),
}));

const { searchTenantContent } = await import("@/services/globalSearch.service");

/** Un hallazgo de desperdicio tal como lo ensambla `azureHardWaste.service`. */
const hallazgo = (name: string, resourceGroup: string, monthlySavingsUSD: number, resourceType = "microsoft.compute/disks") =>
    ({ id: `/subscriptions/s1/resourceGroups/${resourceGroup}/providers/${resourceType}/${name}`, name, resourceGroup, resourceType, monthlySavingsUSD });

beforeEach(() => {
    vi.clearAllMocks();
    query.mockResolvedValue([[]]);
    peekActiveHardWaste.mockResolvedValue([]);
});

describe("buscador de contenido del tenant", () => {
    it("TODA consulta filtra por tenant_id y el tenant es el primer parametro", async () => {
        await searchTenantContent("tenant-A", "prod");

        expect(query).toHaveBeenCalled();
        for (const [sql, params] of query.mock.calls) {
            expect(String(sql)).toMatch(/tenant_id\s*=\s*\?/);
            expect((params as unknown[])[0]).toBe("tenant-A");
        }
    });

    it("escapa los comodines de LIKE", async () => {
        await searchTenantContent("t1", "100%_raro");

        const conTermino = query.mock.calls.find(([, p]) => String((p as unknown[])[1]).includes("100"));
        // Sin escapar, "100%" hace que el LIKE devuelva la tabla entera y
        // "_" matchea cualquier caracter.
        expect(String((conTermino as unknown[][])[1][1])).toBe("%100\\%\\_raro%");
    });

    it("no consulta nada con menos de dos caracteres", async () => {
        const r = await searchTenantContent("t1", "a");
        expect(query).not.toHaveBeenCalled();
        expect(r.results).toEqual([]);
    });

    it("un origen caido no tumba el resto y queda reportado", async () => {
        query.mockImplementation(async (sql: string) => {
            if (String(sql).includes("AlertRules")) throw new Error("Table doesn't exist");
            if (String(sql).includes("service_name")) return [[{ name: "Azure OpenAI", total: 120.5 }]];
            return [[]];
        });

        const r = await searchTenantContent("t1", "azure");

        expect(r.results.some((x) => x.title === "Azure OpenAI")).toBe(true);
        const alertas = r.sourceStatus.find((s) => s.source === "alertRules");
        expect(alertas?.ok).toBe(false);
        expect(r.sourceStatus.find((s) => s.source === "services")?.ok).toBe(true);
        expect(r.sourceStatus.find((s) => s.source === "waste")?.ok).toBe(true);
    });

    describe("origen waste: el escaneo de zombis que ya está en la caché", () => {
        it("filtra por nombre o grupo de recursos, conserva el orden de mayor a menor plata y pone tope por origen", async () => {
            // `peekActiveHardWaste` ya entrega el desperdicio de mayor a menor.
            peekActiveHardWaste.mockResolvedValue([
                hallazgo("disco-test", "rg-test", 500), // no coincide con "prod"
                hallazgo("disco-dev", "rg-PROD-datos", 90), // coincide por el grupo, sin importar mayúsculas
                hallazgo("disco-prod-1", "rg-a", 40),
                hallazgo("ip-prod", "rg-a", 4, "microsoft.network/publicipaddresses"),
                hallazgo("p-3", "x-prod", 3),
                hallazgo("p-2", "x-prod", 2),
                hallazgo("p-1", "x-prod", 1),
            ]);

            const r = await searchTenantContent("t1", "prod");
            const waste = r.results.filter((x) => x.kind === "waste");

            expect(peekActiveHardWaste).toHaveBeenCalledWith("t1");
            expect(waste.map((x) => x.title)).toEqual(["disco-dev", "disco-prod-1", "ip-prod", "p-3", "p-2"]);
            expect(waste[0]).toEqual({
                kind: "waste",
                title: "disco-dev",
                subtitleKey: "wastePerMonth",
                subtitleParams: { amount: "90.00", type: "microsoft.compute/disks" },
                href: "/cleanup/zombies",
            });
            expect(r.sourceStatus.find((s) => s.source === "waste")).toEqual({ source: "waste", ok: true });
        });

        it("`_` y `%` se buscan literales, no como comodines", async () => {
            peekActiveHardWaste.mockResolvedValue([hallazgo("disco_1", "rg", 10), hallazgo("disco-1", "rg", 20), hallazgo("100%", "rg", 5)]);

            expect((await searchTenantContent("t1", "co_1")).results.filter((x) => x.kind === "waste").map((x) => x.title)).toEqual(["disco_1"]);
            expect((await searchTenantContent("t1", "100%")).results.filter((x) => x.kind === "waste").map((x) => x.title)).toEqual(["100%"]);
        });

        it("con la caché fría el origen queda caído (no 'sin resultados'), el resto responde y NO se dispara el escaneo", async () => {
            peekActiveHardWaste.mockResolvedValue(null);
            query.mockImplementation(async (sql: string) => (String(sql).includes("service_name") ? [[{ name: "Cosmos DB", total: 10 }]] : [[]]));

            const r = await searchTenantContent("t1", "cosmos");

            const waste = r.sourceStatus.find((s) => s.source === "waste");
            expect(waste?.ok).toBe(false);
            expect(waste?.error).toMatch(/escaneo/i);
            expect(r.results.some((x) => x.title === "Cosmos DB")).toBe(true);
            // Un escaneo en frío tarda 30 s o más: un buscador que se dispara en cada tecla no puede esperarlo.
            expect(getActiveHardWaste).not.toHaveBeenCalled();
        });

        it("ya no consulta `ZombieResources` (la tabla no existe)", async () => {
            await searchTenantContent("t1", "prod");

            expect(query.mock.calls.some(([sql]) => /ZombieResources/i.test(String(sql)))).toBe(false);
        });
    });

    it("cada resultado lleva un destino al que navegar", async () => {
        query.mockImplementation(async (sql: string) =>
            String(sql).includes("service_name") ? [[{ name: "Cosmos DB", total: 10 }]] : [[]]
        );

        const r = await searchTenantContent("t1", "cosmos");
        expect(r.results[0].href).toContain("/intelligence/billing");
        expect(r.results[0].href).toContain("Cosmos");
    });
});
