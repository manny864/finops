// @vitest-environment node
/**
 * Corridas de pago. Lo que se fija acá es lo que cuesta plata dos veces.
 *
 * El comportamiento completo se verificó contra la base local —piso por
 * beneficiario, separación por moneda, cancelar y liberar, confirmar dos
 * veces— pero eso no deja regresión. Lo que sí la deja es esto: que las
 * consultas conserven los guardas de los que depende no pagar dos veces.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryMock, connMock } = vi.hoisted(() => {
    const queryMock = vi.fn(async () => [[], []] as any);
    const connMock = {
        query: queryMock,
        beginTransaction: vi.fn(async () => {}),
        commit: vi.fn(async () => {}),
        rollback: vi.fn(async () => {}),
        release: vi.fn(),
    };
    return { queryMock, connMock };
});

vi.mock("@/modules/storage/db", () => ({
    default: { query: queryMock, getConnection: async () => connMock },
}));
vi.mock("@/services/commissions.service", () => ({
    promoverComisionesExigibles: vi.fn(async () => ({ promovidas: 0 })),
}));

import { referenciaDeLinea, crearCorrida, previsualizarCorrida } from "@/services/payoutRuns.service";

const sql = () => queryMock.mock.calls.map((c) => String(c[0]).replace(/\s+/g, " "));

beforeEach(() => {
    queryMock.mockReset().mockResolvedValue([[], []] as any);
});

describe("referenciaDeLinea", () => {
    it("es determinista: reenviar el mismo lote tiene que ser idempotente del otro lado", () => {
        expect(referenciaDeLinea(7, "affiliate", "abc")).toBe("run7-aff-abc");
        expect(referenciaDeLinea(7, "affiliate", "abc")).toBe(referenciaDeLinea(7, "affiliate", "abc"));
    });

    it("distingue corrida, tipo y persona", () => {
        const todas = new Set([
            referenciaDeLinea(7, "affiliate", "abc"),
            referenciaDeLinea(8, "affiliate", "abc"),
            referenciaDeLinea(7, "sales_rep", "abc"),
            referenciaDeLinea(7, "affiliate", "abd"),
        ]);
        expect(todas.size).toBe(4);
    });
});

describe("los guardas que impiden pagar dos veces", () => {
    it("sólo toma lo EXIGIBLE que no está en otra corrida", async () => {
        await previsualizarCorrida({ currency: "USD", minimo: 10 });
        const consulta = sql().find((s) => s.includes("FROM Commissions"))!;
        expect(consulta, "sin esto barrería comisiones no exigibles").toContain("c.status = 'DUE'");
        expect(consulta, "SIN ESTO DOS CORRIDAS SE LLEVAN LAS MISMAS COMISIONES").toContain("c.payout_run_id IS NULL");
    });

    it("el piso se aplica al TOTAL por beneficiario, no a cada comisión", async () => {
        // Doce comisiones de $0,30 son $3,60, que puede valer una transferencia
        // aunque ninguna de las doce la valga sola. Por eso es HAVING sobre la
        // suma y no WHERE sobre cada fila.
        await previsualizarCorrida({ currency: "USD", minimo: 10 });
        const consulta = sql().find((s) => s.includes("FROM Commissions"))!;
        expect(consulta).toMatch(/GROUP BY c\.beneficiary_type, c\.beneficiary_id/);
        expect(consulta).toContain("HAVING monto >=");
    });

    it("crear una corrida lee con FOR UPDATE dentro de una transacción", async () => {
        queryMock.mockResolvedValue([[], []] as any); // no hay candidatas
        await crearCorrida({ currency: "USD", minimo: 0, adminEmail: "a@b.c" });
        expect(connMock.beginTransaction).toHaveBeenCalled();
        expect(sql().some((s) => s.includes("FOR UPDATE")), "sin el lock, dos operadores simultáneos duplican el pago").toBe(true);
        // Sin candidatas no se crea una corrida vacía que después haya que cancelar.
        expect(sql().some((s) => s.includes("INSERT INTO PayoutRuns"))).toBe(false);
        expect(connMock.rollback).toHaveBeenCalled();
    });

    // Un reembolso PEDIDO y todavía sin resolver: si la comisión se pagara ahora y Paddle lo aprobara después, quedaría PAGADA y ya no se
    // puede revertir con un UPDATE. Se retiene hasta que se resuelva (si Paddle lo rechaza, el cobro vuelve a `completed`).
    const RETENCION = /NOT EXISTS \(SELECT 1 FROM BillingTransactions bt WHERE bt\.paddle_transaction_id = c\.paddle_transaction_id AND bt\.status = 'refund_pending'\)/;

    it("la vista previa retiene las comisiones de un cobro con reembolso pendiente", async () => {
        await previsualizarCorrida({ currency: "USD", minimo: 0 });
        expect(sql().find((s) => s.includes("FROM Commissions"))!).toMatch(RETENCION);
    });

    it("crear la corrida retiene lo mismo en la lectura de candidatas y en el UPDATE que las asigna", async () => {
        queryMock
            .mockResolvedValueOnce([[{ beneficiary_type: "affiliate", beneficiary_id: "a1", comisiones: 1, monto: "10.0000" }], []] as any) // candidatas
            .mockResolvedValueOnce([{ insertId: 9 }, []] as any) // INSERT PayoutRuns
            .mockResolvedValue([[], []] as any);
        await crearCorrida({ currency: "USD", minimo: 0, adminEmail: "a@b.c" });
        const lectura = sql().find((s) => s.includes("FOR UPDATE"))!;
        const asignacion = sql().find((s) => s.includes("UPDATE Commissions SET payout_run_id"))!;
        expect(lectura).toMatch(RETENCION);
        expect(asignacion, "sin esto la corrida se llevaría una comisión con reembolso pendiente").toContain("bt.status = 'refund_pending'");
        expect(asignacion).toContain("bt.paddle_transaction_id = Commissions.paddle_transaction_id");
    });

    it("sin nada que pagar devuelve null en vez de una corrida vacía", async () => {
        expect(await crearCorrida({ currency: "USD", minimo: 0, adminEmail: "a@b.c" })).toBeNull();
    });
});
