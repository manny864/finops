import Decimal from "decimal.js";
import pool from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";

/**
 * Libro mayor único de comisiones (MEJ-14, criterios 2 a 4).
 *
 * Afiliados y comerciales liquidan de la misma tabla `Commissions`: lo único
 * que cambia entre unos y otros es CUÁNDO devengan, no cómo se guarda ni cómo
 * se paga. El motor de afiliados (`affiliates.service.ts`) escribe acá desde la
 * migración 20260913-006; este archivo agrega la parte que faltaba, que es el
 * calendario del comercial.
 *
 * LA REGLA DEL COMERCIAL, Y POR QUÉ EL NÚMERO ES MÁS SIMPLE DE LO QUE PARECE
 *
 * La comisión de referencia es el 20% del valor ANUAL de la venta. De ahí salen
 * las dos modalidades:
 *
 * - **Contrato anual**: se cobra un año por adelantado, así que el 20% de ese
 *   cobro ES el 20% anual. Una sola cuota (1 de 1), exigible a partir del 2do
 *   mes de la venta — el período de retención que pide MEJ-14.
 *
 * - **Contrato mensual**: 1/12 del 20% anual por mes. Y como el valor anual es
 *   el cobro mensual × 12, esa cuota se reduce a `20% × cobro mensual`: no hace
 *   falta proyectar el año ni arrastrar el error de redondeo de dividir por 12.
 *   El mes 1 no se liquida (gracia de onboarding) y vence junto con el mes 2,
 *   que es el `2/12 tras el segundo cobro` del criterio 3. Del 3 en adelante,
 *   cada cobro exitoso devenga su cuota y es exigible en el acto, hasta 12.
 *
 * Todo en `Decimal`: son montos que se le pagan a una persona.
 */

export type TipoBeneficiario = "affiliate" | "sales_rep";
export type EstadoComision = "PENDING" | "DUE" | "APPROVED" | "PAID" | "REVERSED" | "CANCELLED";

/** Cuotas de una venta mensual: el 20% anualizado se completa en un año. */
export const CUOTAS_MENSUALES = 12;

/** Meses de retención antes de que una comisión sea exigible. */
export const MESES_DE_RETENCION = 2;

export interface ResultadoDevengo {
    devengada: boolean;
    motivo?: string;
    cuota?: number;
    monto?: string;
}

/**
 * Suma meses a una fecha sin desbordar el día: `sold_at` del 31 de enero + 1 mes
 * es el 28/29 de febrero, no el 2 o 3 de marzo. `setMonth` sí desborda, y un
 * vencimiento corrido de días en el mes equivocado adelanta un pago.
 */
export function sumarMeses(fecha: Date, meses: number): Date {
    const dia = fecha.getUTCDate();
    const base = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + meses, 1));
    const ultimoDiaDelMes = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
    base.setUTCDate(Math.min(dia, ultimoDiaDelMes));
    return base;
}

/** `YYYY-MM-DD` para una columna DATE, sin que el huso corra el día. */
export function fechaSql(fecha: Date): string {
    return fecha.toISOString().slice(0, 10);
}

/**
 * Monto de la comisión. `base` y `pct` llegan como string desde mysql2 y se
 * mantienen en Decimal hasta el string final que va a DECIMAL(12,4).
 */
export function calcularMonto(base: unknown, pct: unknown): string {
    const baseDec = new Decimal(String(base ?? 0));
    const pctDec = new Decimal(String(pct ?? 0));
    if (baseDec.lte(0) || pctDec.lte(0)) return "0.0000";
    return baseDec.times(pctDec).dividedBy(100).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

interface DealComercial {
    salesRepId: string;
    pct: string;
    soldAt: Date;
    contractTerm: "annual" | "monthly";
}

/**
 * El acuerdo comercial del tenant, o null con el motivo por el que no se puede
 * liquidar. Los motivos NO son errores: un tenant sin comercial asignado es lo
 * normal (venta directa, self-service), y un tenant sin `sold_at` es el caso que
 * la migración 20260913-003 dejó a propósito sin inventar una fecha.
 */
async function leerDeal(tenantId: string): Promise<{ deal: DealComercial | null; motivo?: string }> {
    const [rows] = await pool.query<any[]>(
        `SELECT d.sales_rep_id, d.sales_commission_percent, d.sold_at, d.contract_term,
                r.commission_pct AS rep_pct, r.status AS rep_status
           FROM TenantCommercialDeals d
           LEFT JOIN SalesReps r ON r.id = d.sales_rep_id
          WHERE d.tenant_id = ? LIMIT 1`,
        [tenantId]
    );
    const fila = Array.isArray(rows) ? rows[0] : null;
    if (!fila) return { deal: null, motivo: "tenant-sin-acuerdo-comercial" };
    if (!fila.sales_rep_id) return { deal: null, motivo: "sin-comercial-asignado" };
    if (fila.rep_status && fila.rep_status !== "ACTIVE") return { deal: null, motivo: "comercial-no-activo" };
    if (!fila.sold_at) return { deal: null, motivo: "venta-sin-fecha" };

    // El porcentaje del acuerdo manda sobre el del comercial: una venta puede
    // haberse cerrado con una condición distinta a la general.
    const pct = fila.sales_commission_percent ?? fila.rep_pct ?? 20;

    return {
        deal: {
            salesRepId: String(fila.sales_rep_id),
            pct: String(pct),
            soldAt: new Date(fila.sold_at),
            contractTerm: fila.contract_term === "annual" ? "annual" : "monthly",
        },
    };
}

/**
 * Devenga la cuota que este cobro habilita para el comercial que vendió el
 * tenant. Se llama desde el webhook de Paddle, al lado de la comisión del
 * afiliado: las dos pueden existir sobre el mismo cobro y son dos filas
 * distintas.
 *
 * Best-effort igual que la del afiliado: si falla, el cobro ya quedó registrado
 * y el webhook tiene que responder 200. Se loguea fuerte porque significa una
 * comisión que alguien se ganó y no quedó acreditada.
 */
export async function devengarComisionComercial(params: {
    tenantId: string;
    transactionId: string;
    subscriptionId?: string | null;
    baseAmount: string | null;
    currency: string;
    billedAt?: Date | null;
}): Promise<ResultadoDevengo> {
    const { tenantId, transactionId, subscriptionId, baseAmount, currency, billedAt } = params;
    if (!transactionId || !baseAmount) return { devengada: false, motivo: "sin-transaccion-o-monto" };

    try {
        const { deal, motivo } = await leerDeal(tenantId);
        if (!deal) return { devengada: false, motivo };

        const [previas] = await pool.query<any[]>(
            `SELECT COUNT(*) AS n FROM Commissions
              WHERE beneficiary_type = 'sales_rep' AND tenant_id = ?
                AND status <> 'CANCELLED'`,
            [tenantId]
        );
        const yaDevengadas = Number(previas?.[0]?.n || 0);

        const total = deal.contractTerm === "annual" ? 1 : CUOTAS_MENSUALES;
        if (yaDevengadas >= total) {
            // Anual: el 20% es por única vez, la renovación del año que viene no
            // vuelve a pagarlo. Mensual: a las 12 cuotas está completo el 20%
            // anualizado y el mes 13 no devenga nada.
            return { devengada: false, motivo: "comision-anualizada-completa" };
        }

        const cuota = yaDevengadas + 1;
        const monto = calcularMonto(baseAmount, deal.pct);
        if (new Decimal(monto).lte(0)) return { devengada: false, motivo: "comision-cero" };

        // Exigibilidad: las dos primeras cuotas (y la única del contrato anual)
        // vencen al cumplirse la retención; de la tercera en adelante, cada
        // cuota es exigible con su propio cobro.
        const vence =
            cuota <= MESES_DE_RETENCION
                ? sumarMeses(deal.soldAt, MESES_DE_RETENCION)
                : billedAt || new Date();

        const [res] = await pool.query<any>(
            `INSERT IGNORE INTO Commissions
               (beneficiary_type, beneficiary_id, tenant_id, paddle_transaction_id, paddle_subscription_id,
                base_amount, currency, commission_pct, commission_amount,
                installment_number, installment_total, status, billed_at, payment_due_date)
             VALUES ('sales_rep', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
            [
                deal.salesRepId, tenantId, transactionId, subscriptionId || null,
                baseAmount, currency, deal.pct, monto,
                cuota, total, billedAt || null, fechaSql(vence),
            ]
        );
        if (!res?.affectedRows) return { devengada: false, motivo: "ya-devengada" };

        console.log(
            `[comisiones] cuota ${cuota}/${total} de ${monto} ${currency} devengada para el comercial ${deal.salesRepId} (tenant ${tenantId}, txn ${transactionId})`
        );
        return { devengada: true, cuota, monto };
    } catch (e) {
        console.error(`[comisiones] no se pudo devengar la comisión comercial de la txn ${transactionId}:`, errorMessage(e));
        return { devengada: false, motivo: "error" };
    }
}

/**
 * Churn: el tenant se dio de baja.
 *
 * Cancela lo que todavía NO es exigible y deja intacto lo que ya venció. Es la
 * regla de MEJ-14: si cancela antes del 2do mes no se liquida nada; si cancela
 * en el mes 4, se detienen las cuotas futuras sin generar saldos negativos
 * retroactivos. Lo ya pagado o exigible no se toca — descontarle a alguien una
 * comisión que ya se ganó es una decisión contable, no un efecto de un webhook.
 */
export async function cancelarComisionesPorChurn(tenantId: string): Promise<{ canceladas: number }> {
    if (!tenantId) return { canceladas: 0 };
    try {
        const [res] = await pool.query<any>(
            `UPDATE Commissions SET status = 'CANCELLED'
              WHERE tenant_id = ? AND beneficiary_type = 'sales_rep' AND status = 'PENDING'`,
            [tenantId]
        );
        const canceladas = Number(res?.affectedRows || 0);
        if (canceladas > 0) console.log(`[comisiones] ${canceladas} cuota(s) no exigibles canceladas por baja del tenant ${tenantId}`);
        return { canceladas };
    } catch (e) {
        console.error(`[comisiones] no se pudieron cancelar las cuotas del tenant ${tenantId}:`, errorMessage(e));
        return { canceladas: 0 };
    }
}

/**
 * Pasa a `DUE` lo que ya cumplió su fecha de exigibilidad.
 *
 * Va acá y no en un cron nuevo: se llama al listar el panel de liquidación, que
 * es el único momento en que el estado importa. Un cron diario para un UPDATE
 * derivable de una fecha sería una pieza más que mantener y vigilar, y el
 * resultado sería idéntico.
 */
export async function promoverComisionesExigibles(): Promise<{ promovidas: number }> {
    try {
        const [res] = await pool.query<any>(
            `UPDATE Commissions SET status = 'DUE'
              WHERE status = 'PENDING' AND payment_due_date IS NOT NULL AND payment_due_date <= CURDATE()`
        );
        return { promovidas: Number(res?.affectedRows || 0) };
    } catch (e) {
        console.error("[comisiones] no se pudieron promover las comisiones exigibles:", errorMessage(e));
        return { promovidas: 0 };
    }
}

export interface ComisionDelLibro {
    id: number;
    beneficiaryType: TipoBeneficiario;
    beneficiaryId: string;
    beneficiaryName: string | null;
    tenantId: string;
    companyName: string | null;
    transactionId: string;
    baseAmount: string;
    currency: string;
    commissionPct: string;
    commissionAmount: string;
    installment: string | null;
    status: EstadoComision;
    billedAt: string | null;
    paymentDueDate: string | null;
    paidAt: string | null;
    paymentReference: string | null;
}

/**
 * El libro mayor, con el nombre del beneficiario resuelto de la tabla que
 * corresponda a su tipo. Promueve lo exigible antes de leer, así lo que se ve
 * es el estado real y no uno de ayer.
 */
export async function listarLibroDeComisiones(filtro?: {
    beneficiaryType?: TipoBeneficiario;
    beneficiaryId?: string;
    tenantId?: string;
    status?: EstadoComision;
    limite?: number;
}): Promise<ComisionDelLibro[]> {
    await promoverComisionesExigibles();

    const where: string[] = [];
    const args: unknown[] = [];
    if (filtro?.beneficiaryType) { where.push("c.beneficiary_type = ?"); args.push(filtro.beneficiaryType); }
    if (filtro?.beneficiaryId) { where.push("c.beneficiary_id = ?"); args.push(filtro.beneficiaryId); }
    if (filtro?.tenantId) { where.push("c.tenant_id = ?"); args.push(filtro.tenantId); }
    if (filtro?.status) { where.push("c.status = ?"); args.push(filtro.status); }
    const limite = Math.max(1, Math.min(500, filtro?.limite || 200));

    const [rows] = await pool.query<any[]>(
        `SELECT c.id, c.beneficiary_type, c.beneficiary_id,
                COALESCE(a.name, r.name) AS beneficiary_name,
                c.tenant_id, t.company_name, c.paddle_transaction_id,
                c.base_amount, c.currency, c.commission_pct, c.commission_amount,
                c.installment_number, c.installment_total,
                c.status, c.billed_at, c.payment_due_date, c.paid_at, c.payment_reference
           FROM Commissions c
           LEFT JOIN Affiliates a ON c.beneficiary_type = 'affiliate' AND a.id = c.beneficiary_id
           LEFT JOIN SalesReps r ON c.beneficiary_type = 'sales_rep' AND r.id = c.beneficiary_id
           LEFT JOIN Tenants t ON t.tenant_id = c.tenant_id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY c.payment_due_date IS NULL, c.payment_due_date ASC, c.created_at DESC
         LIMIT ${limite}`,
        args
    );

    return (rows || []).map((r) => ({
        id: Number(r.id),
        beneficiaryType: r.beneficiary_type,
        beneficiaryId: r.beneficiary_id,
        beneficiaryName: r.beneficiary_name || null,
        tenantId: r.tenant_id,
        companyName: r.company_name || null,
        transactionId: r.paddle_transaction_id,
        baseAmount: String(r.base_amount),
        currency: r.currency,
        commissionPct: String(r.commission_pct),
        commissionAmount: String(r.commission_amount),
        installment: r.installment_number ? `${r.installment_number}/${r.installment_total}` : null,
        status: r.status,
        billedAt: r.billed_at ? new Date(r.billed_at).toISOString() : null,
        paymentDueDate: r.payment_due_date ? fechaSql(new Date(r.payment_due_date)) : null,
        paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
        paymentReference: r.payment_reference || null,
    }));
}

/**
 * "Marcar como Pagado" del criterio 4.
 *
 * `status <> 'PAID'` en el WHERE: repetir el click no reescribe la fecha de pago
 * ni el comprobante de una liquidación ya hecha. Y no se puede pagar lo que está
 * cancelado o revertido.
 */
export async function marcarComisionesPagadas(
    ids: number[],
    datos: { paidAt?: string | null; reference?: string | null; notes?: string | null; adminEmail: string }
): Promise<{ pagadas: number }> {
    const limpios = (ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (limpios.length === 0) return { pagadas: 0 };

    const fecha = datos.paidAt ? new Date(datos.paidAt) : new Date();
    if (Number.isNaN(fecha.getTime())) throw new Error("La fecha de pago no es válida.");

    const marcadores = limpios.map(() => "?").join(",");
    const [res] = await pool.query<any>(
        `UPDATE Commissions
            SET status = 'PAID', paid_at = ?, paid_by_admin = ?,
                payment_reference = COALESCE(?, payment_reference),
                notes = COALESCE(?, notes)
          WHERE id IN (${marcadores})
            AND status IN ('PENDING', 'DUE', 'APPROVED')`,
        [fecha, datos.adminEmail, datos.reference || null, datos.notes || null, ...limpios]
    );
    return { pagadas: Number(res?.affectedRows || 0) };
}

export interface ResumenBeneficiario {
    beneficiaryType: TipoBeneficiario;
    beneficiaryId: string;
    name: string | null;
    email: string | null;
    currency: string | null;
    exigible: string;
    pendiente: string;
    pagado: string;
}

/**
 * Cuánto se le debe a cada uno, junto. Es la vista que la tabla única hace
 * posible: alguien que es afiliado Y comercial aparece con sus dos renglones en
 * la misma pantalla en vez de en dos módulos que nadie cruza.
 */
export async function resumenPorBeneficiario(): Promise<ResumenBeneficiario[]> {
    await promoverComisionesExigibles();

    const [rows] = await pool.query<any[]>(
        `SELECT c.beneficiary_type, c.beneficiary_id,
                COALESCE(a.name, r.name) AS name,
                COALESCE(a.email, r.email) AS email,
                MAX(c.currency) AS currency,
                COALESCE(SUM(CASE WHEN c.status = 'DUE' THEN c.commission_amount END), 0) AS exigible,
                COALESCE(SUM(CASE WHEN c.status IN ('PENDING', 'APPROVED') THEN c.commission_amount END), 0) AS pendiente,
                COALESCE(SUM(CASE WHEN c.status = 'PAID' THEN c.commission_amount END), 0) AS pagado
           FROM Commissions c
           LEFT JOIN Affiliates a ON c.beneficiary_type = 'affiliate' AND a.id = c.beneficiary_id
           LEFT JOIN SalesReps r ON c.beneficiary_type = 'sales_rep' AND r.id = c.beneficiary_id
          GROUP BY c.beneficiary_type, c.beneficiary_id, name, email
          ORDER BY exigible DESC, pendiente DESC`
    );

    return (rows || []).map((r) => ({
        beneficiaryType: r.beneficiary_type,
        beneficiaryId: r.beneficiary_id,
        name: r.name || null,
        email: r.email || null,
        currency: r.currency || null,
        exigible: String(r.exigible ?? "0"),
        pendiente: String(r.pendiente ?? "0"),
        pagado: String(r.pagado ?? "0"),
    }));
}
