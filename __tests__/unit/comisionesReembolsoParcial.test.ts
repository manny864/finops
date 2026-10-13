// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("@/modules/storage/db", () => ({ default: { query: (...a: unknown[]) => queryMock(...a) } }));

import { ajustarComisionesPorReembolsoParcial } from "@/services/commissions.service";

/**
 * Un reembolso PARCIAL aprobado reduce la comisión en la misma proporción en que se devolvió el cobro: ni el afiliado ni el comercial
 * cobran por plata que se devolvió. Una comisión ya PAGADA no se toca (se anota para descontarla de la liquidación siguiente).
 */
const TXN = "txn_01m4rzzzzzzzzzzzzzzzzzzzzz";
const ADJ = "adj_01m4ajuste00000000000000a";

const fila = (extra: Record<string, unknown> = {}) => ({ id: 1, base_amount: "100.0000", commission_pct: "20.00", status: "PENDING", notes: null, ...extra });
const libro = (...filas: unknown[]) => queryMock.mockImplementation(async (sql: string) => (String(sql).startsWith("SELECT") ? [filas] : [{ affectedRows: 1 }]));
const escrituras = () => queryMock.mock.calls.filter(([sql]) => !String(sql).startsWith("SELECT"));
const pedir = (subtotalReembolsado: string, adjustmentId = ADJ) => ajustarComisionesPorReembolsoParcial({ transactionId: TXN, adjustmentId, subtotalReembolsado });

beforeEach(() => {
  queryMock.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ajustarComisionesPorReembolsoParcial", () => {
  it("baja la base y la comisión en proporción: 27 devueltos de 100 con 20% -> base 73, comisión 14,60", async () => {
    libro(fila());
    expect(await pedir("27.00")).toEqual({ reducidas: 1, revertidas: 0, pagadasARevisar: 0 });
    const [sql, params] = escrituras()[0];
    expect(String(sql)).toContain("SET base_amount = ?, commission_amount = ?");
    expect(params.slice(0, 2)).toEqual(["73.0000", "14.6000"]);
    expect(params[3]).toBe(1);
  });

  it.each(["PENDING", "DUE", "APPROVED"])("una comisión %s se reduce", async (status) => {
    libro(fila({ status }));
    expect((await pedir("10.00")).reducidas).toBe(1);
  });

  it("el afiliado y el comercial del MISMO cobro se reducen los dos (misma base y su propio %)", async () => {
    libro(fila({ id: 1, commission_pct: "20.00" }), fila({ id: 2, commission_pct: "10.00" }));
    expect((await pedir("50.00")).reducidas).toBe(2);
    expect(escrituras().map(([, p]) => p[1])).toEqual(["10.0000", "5.0000"]);
  });

  it("si lo devuelto agota la base, la comisión pasa a REVERSED", async () => {
    libro(fila());
    expect(await pedir("100.00")).toEqual({ reducidas: 0, revertidas: 1, pagadasARevisar: 0 });
    expect(String(escrituras()[0][0])).toContain("SET status = 'REVERSED'");
  });

  it("devolver más que la base no deja una comisión negativa", async () => {
    libro(fila());
    expect((await pedir("250.00")).revertidas).toBe(1);
  });

  it("una comisión ya PAGADA no se toca: queda anotada para descontarla de la liquidación siguiente", async () => {
    libro(fila({ status: "PAID" }));
    expect(await pedir("27.00")).toEqual({ reducidas: 0, revertidas: 0, pagadasARevisar: 1 });
    const [sql] = escrituras()[0];
    expect(String(sql)).toContain("SET notes = CONCAT");
    expect(String(sql)).not.toContain("commission_amount");
    expect(String(sql)).not.toContain("status");
  });

  it.each(["REVERSED", "CANCELLED"])("una comisión %s no se vuelve a tocar", async (status) => {
    libro(fila({ status }));
    expect(await pedir("27.00")).toEqual({ reducidas: 0, revertidas: 0, pagadasARevisar: 0 });
    expect(escrituras()).toHaveLength(0);
  });

  it("es idempotente por ajuste: la fila que ya lleva la marca [adj_...] no se reduce dos veces", async () => {
    libro(fila({ notes: `\n[${ADJ}] Reembolso parcial de 27.00: base 100.00 -> 73.00.`, base_amount: "73.0000" }));
    expect(await pedir("27.00")).toEqual({ reducidas: 0, revertidas: 0, pagadasARevisar: 0 });
    expect(escrituras()).toHaveLength(0);
  });

  it("dos ajustes DISTINTOS sobre el mismo cobro se acumulan", async () => {
    libro(fila({ notes: `\n[${ADJ}] ya aplicado`, base_amount: "73.0000" }));
    const r = await pedir("10.00", "adj_01m4otroajuste000000000b");
    expect(r.reducidas).toBe(1);
    expect(escrituras()[0][1].slice(0, 2)).toEqual(["63.0000", "12.6000"]);
  });

  it("deja la marca del ajuste en la fila", async () => {
    libro(fila());
    await pedir("27.00");
    expect(String(escrituras()[0][1][2])).toContain(`[${ADJ}]`);
  });

  it.each([["0"], ["0.00"], [""], ["-5"]])("un reembolso de %j no consulta ni escribe nada", async (monto) => {
    expect(await pedir(monto)).toEqual({ reducidas: 0, revertidas: 0, pagadasARevisar: 0 });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("sin ajuste o sin transacción no hace nada", async () => {
    expect(await ajustarComisionesPorReembolsoParcial({ transactionId: "", adjustmentId: ADJ, subtotalReembolsado: "5" })).toMatchObject({ reducidas: 0 });
    expect(await ajustarComisionesPorReembolsoParcial({ transactionId: TXN, adjustmentId: "", subtotalReembolsado: "5" })).toMatchObject({ reducidas: 0 });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("un cobro sin comisiones (no vino de un afiliado ni de un comercial) no escribe nada", async () => {
    libro();
    expect(await pedir("27.00")).toEqual({ reducidas: 0, revertidas: 0, pagadasARevisar: 0 });
    expect(escrituras()).toHaveLength(0);
  });

  it("si la base falla no lanza: el webhook ya registró el reembolso y tiene que contestar", async () => {
    queryMock.mockRejectedValue(new Error("ECONNRESET"));
    expect(await pedir("27.00")).toEqual({ reducidas: 0, revertidas: 0, pagadasARevisar: 0 });
  });
});
