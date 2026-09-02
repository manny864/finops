// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => queryMock(...a) } }));

import {
    getTagKeysToFetch,
    hasRecentExportTagData,
    ALWAYS_TRACKED_TAG_KEY,
    MAX_TAG_KEYS_PER_RUN,
} from "@/services/costTagSync.service";

beforeEach(() => queryMock.mockReset());

describe("getTagKeysToFetch — MEJ-30 paso 2", () => {
    it("siempre incluye CostCenter, aunque no haya ningún Cost Group por etiqueta", async () => {
        queryMock.mockResolvedValueOnce([[]]);
        expect(await getTagKeysToFetch("t1")).toEqual([ALWAYS_TRACKED_TAG_KEY]);
    });

    it("suma las claves que usan las reglas del tenant, sin duplicar CostCenter", async () => {
        queryMock.mockResolvedValueOnce([[
            { match_tag_key: "Equipo" },
            { match_tag_key: "CostCenter" },
            { match_tag_key: "Proyecto" },
        ]]);
        const keys = await getTagKeysToFetch("t1");
        expect(keys).toEqual(["CostCenter", "Equipo", "Proyecto"]);
        expect(keys.filter(k => k === "CostCenter")).toHaveLength(1);
    });

    // Cada clave es una consulta MÁS por scope y por día. Sin tope, un tenant
    // con muchos Cost Groups por etiqueta se lleva puesta la cuota de Cost
    // Management del resto del sync.
    it("corta en el tope de claves por corrida", async () => {
        queryMock.mockResolvedValueOnce([[
            ...Array.from({ length: 20 }, (_, i) => ({ match_tag_key: `k${i}` })),
        ]]);
        const keys = await getTagKeysToFetch("t1");
        expect(keys).toHaveLength(MAX_TAG_KEYS_PER_RUN);
    });
});

describe("hasRecentExportTagData — el gate que evita consultas de más", () => {
    // Criterio de aceptación 3 de MEJ-30: los tenants con export no deben
    // aumentar su cantidad de consultas a Cost Management.
    it("es true si hay filas recientes con procedencia de etiquetas", async () => {
        queryMock.mockResolvedValueOnce([[{ 1: 1 }]]);
        expect(await hasRecentExportTagData("t1")).toBe(true);
    });

    it("es false si no hay ninguna: ese tenant sí necesita el fetch", async () => {
        queryMock.mockResolvedValueOnce([[]]);
        expect(await hasRecentExportTagData("t1")).toBe(false);
    });

    it("mira una ventana reciente, no la tabla entera", async () => {
        queryMock.mockResolvedValueOnce([[]]);
        await hasRecentExportTagData("t1", 7);
        expect(queryMock.mock.calls[0][0]).toContain("DATE_SUB(CURDATE(), INTERVAL ? DAY)");
        expect(queryMock.mock.calls[0][1]).toEqual(["t1", 7]);
    });
});
