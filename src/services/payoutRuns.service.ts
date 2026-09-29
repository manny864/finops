/**
 * Corridas de pago: el puente entre "el libro dice que le debo $X a Laura" y
 * "le transferí $X a Laura y este es el comprobante".
 *
 * UNA CORRIDA ES UN LOTE. Toma todo lo EXIGIBLE de una moneda, lo agrupa por
 * beneficiario, deja afuera a quien no llega al piso, y queda abierta hasta que
 * se confirma el pago. Recién ahí las comisiones pasan a `PAID`, todas juntas y
 * con el mismo comprobante.
 *
 * POR QUÉ IMPORTA EL AGRUPAMIENTO Y NO ES SÓLO COMODIDAD: una transferencia le
 * paga a una persona el total de N comisiones. Marcarlas de a una deja N filas
 * que dicen "pagada" sin nada que las ate al movimiento real, y al primer
 * reclamo hay que reconstruir a mano qué cubrió cada transferencia.
 *
 * LAS LÍNEAS SE DERIVAN, no se guardan: un total guardado puede divergir de sus
 * sumandos y el primer reembolso lo haría divergir. Ver la migración
 * 20260928-002.
 *
 * TODO EN `Decimal`: son montos que se le pagan a una persona.
 */

import Decimal from "decimal.js";
import pool from "@/modules/storage/db";
import { promoverComisionesExigibles } from "./commissions.service";

export type EstadoCorrida = "OPEN" | "PAID" | "CANCELLED";

export interface LineaDeCorrida {
    beneficiaryType: "affiliate" | "sales_rep";
    beneficiaryId: string;
    nombre: string | null;
    email: string | null;
    payoutMethod: string | null;
    payoutReference: string | null;
    comisiones: number;
    monto: string;
    /**
     * El identificador de ESTA línea para el rail de pago. Determinista a
     * propósito: reenviar el mismo lote tiene que ser idempotente del otro
     * lado, y un id generado al azar en cada intento no lo sería.
     */
    referencia: string;
}

export interface Corrida {
    id: number;
    currency: string;
    minimumAmount: string;
    status: EstadoCorrida;
    createdAt: string | null;
    createdBy: string;
    paidAt: string | null;
    paidBy: string | null;
    notes: string | null;
    lineas: LineaDeCorrida[];
    total: string;
}

/** `client_reference_id` de la línea. Estable para (corrida, beneficiario). */
export function referenciaDeLinea(runId: number, tipo: string, beneficiarioId: string): string {
    return `run${runId}-${tipo === "sales_rep" ? "rep" : "aff"}-${beneficiarioId}`;
}

const SELECT_LINEAS = `
    SELECT c.beneficiary_type, c.beneficiary_id,
           COALESCE(a.name, r.name) AS nombre,
           COALESCE(a.email, r.email) AS email,
           COALESCE(a.payout_method, r.payout_method) AS payout_method,
           COALESCE(a.payout_reference, r.payout_reference) AS payout_reference,
           COUNT(*) AS comisiones,
           SUM(c.commission_amount) AS monto
      FROM Commissions c
      LEFT JOIN Affiliates a ON c.beneficiary_type = 'affiliate' AND a.id = c.beneficiary_id
      LEFT JOIN SalesReps r ON c.beneficiary_type = 'sales_rep' AND r.id = c.beneficiary_id`;

function armarLineas(rows: any[], runId: number): LineaDeCorrida[] {
    return (rows || []).map((l) => ({
        beneficiaryType: l.beneficiary_type,
        beneficiaryId: l.beneficiary_id,
        nombre: l.nombre || null,
        email: l.email || null,
        payoutMethod: l.payout_method || null,
        payoutReference: l.payout_reference || null,
        comisiones: Number(l.comisiones || 0),
        monto: new Decimal(String(l.monto ?? 0)).toFixed(4),
        referencia: referenciaDeLinea(runId, l.beneficiary_type, l.beneficiary_id),
    }));
}

const sumar = (lineas: LineaDeCorrida[]) =>
    lineas.reduce((t, l) => t.plus(l.monto), new Decimal(0)).toFixed(4);

/**
 * Qué entraría en una corrida de esta moneda con este piso, SIN crear nada.
 *
 * El piso se aplica al TOTAL POR BENEFICIARIO y no por comisión: cobrar $0,30
 * doce veces son $3,60, que puede valer una transferencia aunque ninguna de las
 * doce la valga sola.
 */
export async function previsualizarCorrida(params: {
    currency: string;
    minimo?: string | number;
}): Promise<LineaDeCorrida[]> {
    await promoverComisionesExigibles();
    const minimo = new Decimal(String(params.minimo ?? 0));
    const [rows] = await pool.query<any[]>(
        `${SELECT_LINEAS}
          WHERE c.status = 'DUE' AND c.payout_run_id IS NULL AND c.currency = ?
          GROUP BY c.beneficiary_type, c.beneficiary_id, nombre, email, payout_method, payout_reference
         HAVING monto >= ?
          ORDER BY monto DESC`,
        [params.currency, minimo.toFixed(4)],
    );
    // `runId` 0: la previsualización todavía no tiene corrida, y la referencia
    // sólo existe una vez creada.
    return armarLineas(rows, 0);
}

/**
 * Crea la corrida y se lleva las comisiones.
 *
 * EN UNA TRANSACCIÓN Y CON `payout_run_id IS NULL` EN EL WHERE. Dos operadores
 * armando corridas a la vez se llevarían las mismas comisiones y se pagaría dos
 * veces; el candado es esa condición, no el orden del código.
 *
 * Devuelve `null` si no quedó nada por encima del piso, en vez de crear una
 * corrida vacía que después hay que cancelar.
 */
export async function crearCorrida(params: {
    currency: string;
    minimo?: string | number;
    adminEmail: string;
    notes?: string | null;
}): Promise<Corrida | null> {
    await promoverComisionesExigibles();
    const minimo = new Decimal(String(params.minimo ?? 0));
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [candidatas] = await conn.query<any[]>(
            `${SELECT_LINEAS}
              WHERE c.status = 'DUE' AND c.payout_run_id IS NULL AND c.currency = ?
              GROUP BY c.beneficiary_type, c.beneficiary_id, nombre, email, payout_method, payout_reference
             HAVING monto >= ?
              FOR UPDATE`,
            [params.currency, minimo.toFixed(4)],
        );
        if (!candidatas?.length) { await conn.rollback(); return null; }

        const [res] = await conn.query<any>(
            `INSERT INTO PayoutRuns (currency, minimum_amount, created_by, notes)
             VALUES (?,?,?,?)`,
            [params.currency, minimo.toFixed(4), params.adminEmail, params.notes || null],
        );
        const runId = Number(res.insertId);

        // Sólo las comisiones de los beneficiarios que pasaron el piso. Un
        // `UPDATE ... WHERE currency = ?` a secas se llevaría también a los que
        // quedaron abajo, y su saldo dejaría de arrastrarse.
        for (const l of candidatas) {
            await conn.query(
                `UPDATE Commissions SET payout_run_id = ?
                  WHERE status = 'DUE' AND payout_run_id IS NULL AND currency = ?
                    AND beneficiary_type = ? AND beneficiary_id = ?`,
                [runId, params.currency, l.beneficiary_type, l.beneficiary_id],
            );
        }

        await conn.commit();
        return (await detalleCorrida(runId))!;
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
}

export async function detalleCorrida(runId: number): Promise<Corrida | null> {
    const [[run]] = await pool.query<any[]>(`SELECT * FROM PayoutRuns WHERE id = ?`, [runId]) as any;
    if (!run) return null;

    const [rows] = await pool.query<any[]>(
        `${SELECT_LINEAS}
          WHERE c.payout_run_id = ?
          GROUP BY c.beneficiary_type, c.beneficiary_id, nombre, email, payout_method, payout_reference
          ORDER BY monto DESC`,
        [runId],
    );
    const lineas = armarLineas(rows, runId);

    return {
        id: runId,
        currency: run.currency,
        minimumAmount: String(run.minimum_amount),
        status: run.status,
        createdAt: run.created_at ? new Date(run.created_at).toISOString() : null,
        createdBy: run.created_by,
        paidAt: run.paid_at ? new Date(run.paid_at).toISOString() : null,
        paidBy: run.paid_by || null,
        notes: run.notes || null,
        lineas,
        total: sumar(lineas),
    };
}

export async function listarCorridas(limite = 50): Promise<Array<Omit<Corrida, "lineas">>> {
    const [rows] = await pool.query<any[]>(
        `SELECT p.*,
                (SELECT COALESCE(SUM(c.commission_amount), 0) FROM Commissions c WHERE c.payout_run_id = p.id) AS total,
                (SELECT COUNT(DISTINCT CONCAT(c.beneficiary_type, c.beneficiary_id))
                   FROM Commissions c WHERE c.payout_run_id = p.id) AS beneficiarios
           FROM PayoutRuns p
          ORDER BY p.created_at DESC
          LIMIT ${Math.max(1, Math.min(200, limite))}`,
    );
    return (rows || []).map((r) => ({
        id: Number(r.id),
        currency: r.currency,
        minimumAmount: String(r.minimum_amount),
        status: r.status,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
        createdBy: r.created_by,
        paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
        paidBy: r.paid_by || null,
        notes: r.notes || null,
        total: new Decimal(String(r.total ?? 0)).toFixed(4),
        beneficiarios: Number(r.beneficiarios || 0),
    })) as any;
}

/**
 * Confirma que la corrida se pagó. `referencias` mapea la referencia de cada
 * línea al comprobante real de esa transferencia; lo que no venga queda con el
 * comprobante general de la corrida.
 *
 * Sólo avanza desde `OPEN`. Confirmar dos veces la misma corrida no vuelve a
 * tocar nada, que es lo que hace seguro reintentar.
 */
export async function marcarCorridaPagada(
    runId: number,
    datos: {
        adminEmail: string;
        paidAt?: string | null;
        reference?: string | null;
        referencias?: Record<string, string>;
    },
): Promise<{ pagadas: number } | null> {
    const fecha = datos.paidAt ? new Date(datos.paidAt) : new Date();
    if (Number.isNaN(fecha.getTime())) throw new Error("La fecha de pago no es válida.");

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [res] = await conn.query<any>(
            `UPDATE PayoutRuns SET status = 'PAID', paid_at = ?, paid_by = ? WHERE id = ? AND status = 'OPEN'`,
            [fecha, datos.adminEmail, runId],
        );
        if (!res?.affectedRows) { await conn.rollback(); return null; }

        const [lineas] = await conn.query<any[]>(
            `SELECT DISTINCT beneficiary_type, beneficiary_id FROM Commissions WHERE payout_run_id = ?`,
            [runId],
        );
        let pagadas = 0;
        for (const l of lineas || []) {
            const propia = datos.referencias?.[referenciaDeLinea(runId, l.beneficiary_type, l.beneficiary_id)];
            const [r] = await conn.query<any>(
                `UPDATE Commissions
                    SET status = 'PAID', paid_at = ?, paid_by_admin = ?, payment_reference = ?
                  WHERE payout_run_id = ? AND beneficiary_type = ? AND beneficiary_id = ?
                    AND status IN ('PENDING', 'DUE', 'APPROVED')`,
                [fecha, datos.adminEmail, propia || datos.reference || null,
                 runId, l.beneficiary_type, l.beneficiary_id],
            );
            pagadas += Number(r?.affectedRows || 0);
        }

        await conn.commit();
        return { pagadas };
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
}

/**
 * Cancela una corrida y LIBERA sus comisiones para la siguiente.
 *
 * Sólo desde `OPEN`: una corrida ya pagada no se cancela, porque la plata ya
 * salió. Eso se arregla con un ajuste, no con un UPDATE.
 */
export async function cancelarCorrida(runId: number): Promise<boolean> {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [res] = await conn.query<any>(
            `UPDATE PayoutRuns SET status = 'CANCELLED' WHERE id = ? AND status = 'OPEN'`, [runId],
        );
        if (!res?.affectedRows) { await conn.rollback(); return false; }
        await conn.query(`UPDATE Commissions SET payout_run_id = NULL WHERE payout_run_id = ?`, [runId]);
        await conn.commit();
        return true;
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
}
