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

const { searchTenantContent } = await import("@/services/globalSearch.service");

beforeEach(() => {
    vi.clearAllMocks();
    query.mockResolvedValue([[]]);
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
            if (String(sql).includes("ZombieResources")) throw new Error("Table doesn't exist");
            if (String(sql).includes("service_name")) return [[{ name: "Azure OpenAI", total: 120.5 }]];
            return [[]];
        });

        const r = await searchTenantContent("t1", "azure");

        expect(r.results.some((x) => x.title === "Azure OpenAI")).toBe(true);
        const waste = r.sourceStatus.find((s) => s.source === "waste");
        expect(waste?.ok).toBe(false);
        expect(r.sourceStatus.find((s) => s.source === "services")?.ok).toBe(true);
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
