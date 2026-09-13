// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => queryMock(...a) } }));

import { getMaturityScorePolicy } from "@/services/azureMaturity.service";

/**
 * El lector decide con qué se calcula el radar de madurez de un tenant. Un
 * default mal puesto no rompe nada visible: cambia los números y nadie se
 * entera, que es el modo de falla que este módulo ya sufrió (MEJ-08).
 */
describe("getMaturityScorePolicy", () => {
    beforeEach(() => queryMock.mockReset());

    it("devuelve la política guardada cuando es válida", async () => {
        for (const pol of ["telemetry", "blended_50_50", "self_assessment"]) {
            queryMock.mockResolvedValueOnce([[{ maturity_score_policy: pol }]]);
            expect(await getMaturityScorePolicy("t1")).toBe(pol);
        }
    });

    it("un tenant sin fila de settings cae al comportamiento histórico", async () => {
        queryMock.mockResolvedValueOnce([[]]);
        expect(await getMaturityScorePolicy("t1")).toBe("self_assessment");
    });

    it("un valor basura en la columna NO se propaga", async () => {
        // Si alguien amplía el ENUM en la base sin tocar el código, el valor
        // desconocido tiene que caer al default y no viajar a la UI.
        queryMock.mockResolvedValueOnce([[{ maturity_score_policy: "lo_que_sea" }]]);
        expect(await getMaturityScorePolicy("t1")).toBe("self_assessment");
    });

    it("si la base se cae, el radar no cambia", async () => {
        queryMock.mockRejectedValueOnce(new Error("ER_NO_SUCH_TABLE"));
        expect(await getMaturityScorePolicy("t1")).toBe("self_assessment");
    });
});
