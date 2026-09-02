// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => queryMock(...a) } }));

import { decideTagExactness, getTagCoverage } from "@/lib/costTagCoverage";

beforeEach(() => queryMock.mockReset());

describe("decideTagExactness — MEJ-30 paso 3", () => {
    it("es exacto cuando todo el costo del período tiene procedencia de etiquetas", () => {
        expect(decideTagExactness(1000, 1000)).toBe(true);
    });

    // El caso que motiva el criterio: el sync vía Cost Management no escribe
    // Tags ni ResourceId, así que su costo no tiene procedencia. Tratarlo como
    // exacto haría que un Cost Group por etiqueta devuelva una sub-cuenta
    // silenciosa en vez de aproximar por Resource Group.
    it("NO es exacto si queda costo sin procedencia", () => {
        expect(decideTagExactness(999, 1000)).toBe(false);
    });

    it("NO es exacto a mitad de migración (parte export, parte sync)", () => {
        expect(decideTagExactness(600, 1000)).toBe(false);
    });

    it("un período sin gasto no se declara exacto", () => {
        // Declararlo exacto haría que un tenant nuevo, sin datos todavía,
        // apague la aproximación y muestre $0.00 como si fuera un hallazgo.
        expect(decideTagExactness(0, 0)).toBe(false);
    });

    it("tolera la diferencia de centavo entre dos SUM de DECIMAL", () => {
        expect(decideTagExactness(999.9999, 1000)).toBe(true);
    });
});

describe("getTagCoverage", () => {
    it("cuenta como procedencia las filas con ResourceId o con Tags", async () => {
        queryMock.mockResolvedValueOnce([[{ costTotal: "500.0000", costWithProvenance: "500.0000" }]]);

        const result = await getTagCoverage("t1", "2026-08-01", "2026-08-31");

        expect(result.isExact).toBe(true);
        const sql = queryMock.mock.calls[0][0] as string;
        expect(sql).toContain("ResourceId IS NOT NULL OR Tags IS NOT NULL");
        expect(queryMock.mock.calls[0][1]).toEqual(["t1", "2026-08-01", "2026-08-31"]);
    });

    it("un tenant sin filas devuelve no-exacto en vez de romper", async () => {
        queryMock.mockResolvedValueOnce([[{ costTotal: null, costWithProvenance: null }]]);
        const result = await getTagCoverage("t1", "2026-08-01", "2026-08-31");
        expect(result).toEqual({ costTotal: 0, costWithProvenance: 0, isExact: false });
    });
});
