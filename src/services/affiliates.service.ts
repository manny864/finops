/**
 * Programa de afiliados: atribución de referidos y devengo de comisiones.
 *
 * El flujo completo, y por qué es más corto de lo que parece:
 *
 *   link `?ref=codigo` → cookie en el browser → `/api/onboard` la lee y graba
 *   AffiliateReferrals(afiliado, tenant) → el webhook de Paddle, al cobrar,
 *   resuelve tenant_id → referido → comisión.
 *
 * NO se pasa el código por `custom_data` de Paddle. El referido ya vive del
 * lado del servidor indexado por tenant, y `handleTransactionCompleted` ya
 * resuelve el tenant (por custom_data o por paddle_subscription_id). Meterlo
 * también en la pasarela obligaría a tocar los 7 lugares que arman checkouts,
 * y encima haría que la atribución dependa de un valor que el cliente puede
 * editar en su localStorage justo antes de pagar. Acá el cliente sólo puede
 * influir en el ALTA, una vez, y con el guard de auto-referido de por medio.
 *
 * Todo el dinero se calcula con Decimal. mysql2 devuelve las columnas DECIMAL
 * como STRING (`commission_pct` llega "20.00", no 20), así que convertir con
 * parseFloat y multiplicar sería doble error: precisión binaria sobre un valor
 * que ya venía en decimal exacto.
 */
import Decimal from "decimal.js";
import type { Pool, PoolConnection } from "mysql2/promise";
import pool from "@/modules/storage/db";
import { errorMessage } from "@/lib/apiErrors";

/** Acepta un pool o una conexión: la atribución corre dentro de la transacción del onboarding. */
type Ejecutor = Pool | PoolConnection;

export type EstadoComision = "PENDING" | "APPROVED" | "PAID" | "REVERSED" | "CANCELLED";

export interface AfiliadoResuelto {
    id: string;
    email: string;
    commissionPct: string;
}

export type ResultadoAtribucion =
    | { atribuido: true; affiliateId: string }
    | { atribuido: false; motivo: "sin-codigo" | "codigo-desconocido" | "auto-referido" | "ya-atribuido" };

/**
 * El código viaja en una URL tipeada o pegada por una persona. Se normaliza a
 * minúsculas y se recorta al largo de la columna; cualquier cosa con caracteres
 * fuera del alfabeto de un código se descarta en vez de ir a la consulta.
 */
export function normalizarCodigo(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const limpio = raw.trim().toLowerCase();
    if (!limpio || limpio.length > 64) return null;
    return /^[a-z0-9][a-z0-9_-]*$/.test(limpio) ? limpio : null;
}

/**
 * Comisión devengada. `pct` llega como string desde mysql2 y se mantiene en
 * Decimal hasta el string final que va a la columna DECIMAL(12,4).
 */
export function calcularComision(base: unknown, pct: unknown): string {
    const baseDec = new Decimal(String(base ?? 0));
    const pctDec = new Decimal(String(pct ?? 0));
    if (baseDec.lte(0) || pctDec.lte(0)) return "0.0000";
    return baseDec.times(pctDec).dividedBy(100).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

export async function buscarAfiliadoPorCodigo(
    ejecutor: Ejecutor,
    codigo: string
): Promise<AfiliadoResuelto | null> {
    const [rows] = await ejecutor.query<any[]>(
        `SELECT id, email, commission_pct FROM Affiliates
         WHERE referral_code = ? AND status = 'ACTIVE' LIMIT 1`,
        [codigo]
    );
    const fila = Array.isArray(rows) ? rows[0] : null;
    if (!fila) return null;
    return { id: fila.id, email: String(fila.email || "").toLowerCase(), commissionPct: String(fila.commission_pct) };
}

/**
 * Atribuye el tenant al afiliado del código. Idempotente y de primer toque:
 * `uq_referral_tenant` hace que el primer afiliado gane y que llamar a esto en
 * cada login (que es lo que hace /api/onboard) no cambie nada.
 *
 * Guard de auto-referido: el código llega en una cookie que el cliente escribe,
 * así que nada impide que alguien se ponga su propio código antes de darse de
 * alta. Es el chequeo que el acuerdo de afiliados menciona y que sin esto queda
 * sólo en el papel.
 *
 * Se compara contra DOS fuentes y las dos hacen falta. `emailActual` es el de
 * la identidad que MSAL ya verificó en /api/onboard, y es la única que sirve en
 * el primer alta: en ese momento la fila de Users todavía no está insertada, así
 * que mirar sólo la tabla dejaría pasar justo el caso que importa — el afiliado
 * dándose de alta a sí mismo. La consulta a Users cubre el resto: alguien que
 * ya es miembro del tenant y se atribuye la cuenta más tarde.
 */
export async function atribuirReferido(
    ejecutor: Ejecutor,
    tenantId: string,
    codigoRaw: unknown,
    emailActual?: string | null
): Promise<ResultadoAtribucion> {
    const codigo = normalizarCodigo(codigoRaw);
    if (!codigo) return { atribuido: false, motivo: "sin-codigo" };

    const afiliado = await buscarAfiliadoPorCodigo(ejecutor, codigo);
    if (!afiliado) return { atribuido: false, motivo: "codigo-desconocido" };

    if (afiliado.email && String(emailActual || "").trim().toLowerCase() === afiliado.email) {
        return { atribuido: false, motivo: "auto-referido" };
    }

    const [usuarios] = await ejecutor.query<any[]>(
        `SELECT 1 FROM Users WHERE tenant_id = ? AND LOWER(email) = ? LIMIT 1`,
        [tenantId, afiliado.email]
    );
    if (Array.isArray(usuarios) && usuarios.length > 0) {
        return { atribuido: false, motivo: "auto-referido" };
    }

    const [res] = await ejecutor.query<any>(
        `INSERT IGNORE INTO AffiliateReferrals (affiliate_id, tenant_id) VALUES (?, ?)`,
        [afiliado.id, tenantId]
    );
    if (!res?.affectedRows) return { atribuido: false, motivo: "ya-atribuido" };
    return { atribuido: true, affiliateId: afiliado.id };
}

/**
 * Devenga la comisión de un cobro. Se llama desde el webhook de Paddle, que ya
 * verificó la firma.
 *
 * `INSERT IGNORE` contra `uq_commission_transaction`: Paddle reintenta la
 * entrega ante cualquier respuesta que no sea 2xx y puede reenviar el mismo
 * evento, así que la segunda vez esto no hace nada en vez de pagar dos veces.
 * La idempotencia la garantiza el índice, no el orden del código.
 *
 * Best-effort a propósito: si falla, el cobro del cliente ya quedó registrado y
 * el webhook debe responder 200. Se loguea fuerte porque significa una comisión
 * devengada que no se acreditó.
 */
export async function devengarComision(params: {
    tenantId: string;
    transactionId: string;
    subscriptionId?: string | null;
    baseAmount: string | null;
    currency: string;
    billedAt?: Date | null;
}): Promise<{ devengada: boolean; motivo?: string }> {
    const { tenantId, transactionId, subscriptionId, baseAmount, currency, billedAt } = params;
    if (!transactionId || !baseAmount) return { devengada: false, motivo: "sin-transaccion-o-monto" };

    try {
        const [rows] = await pool.query<any[]>(
            `SELECT r.affiliate_id, a.commission_pct
             FROM AffiliateReferrals r
             JOIN Affiliates a ON a.id = r.affiliate_id
             WHERE r.tenant_id = ? AND a.status = 'ACTIVE' LIMIT 1`,
            [tenantId]
        );
        const referido = Array.isArray(rows) ? rows[0] : null;
        if (!referido) return { devengada: false, motivo: "tenant-sin-afiliado" };

        const pct = String(referido.commission_pct);
        const comision = calcularComision(baseAmount, pct);
        if (new Decimal(comision).lte(0)) return { devengada: false, motivo: "comision-cero" };

        const [res] = await pool.query<any>(
            `INSERT IGNORE INTO AffiliateCommissions
               (affiliate_id, tenant_id, paddle_transaction_id, paddle_subscription_id,
                base_amount, currency, commission_pct, commission_amount, status, billed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
            [referido.affiliate_id, tenantId, transactionId, subscriptionId || null,
             baseAmount, currency, pct, comision, billedAt || null]
        );
        if (!res?.affectedRows) return { devengada: false, motivo: "ya-devengada" };

        console.log(`[affiliates] comisión ${comision} ${currency} devengada para ${referido.affiliate_id} (txn ${transactionId})`);
        return { devengada: true };
    } catch (e) {
        console.error(`[affiliates] no se pudo devengar la comisión de la txn ${transactionId}:`, errorMessage(e));
        return { devengada: false, motivo: "error" };
    }
}

/**
 * Revierte la comisión de un cobro reembolsado. Sólo toca las que todavía no se
 * pagaron: una comisión ya liquidada al afiliado no se puede deshacer con un
 * UPDATE, se descuenta de la liquidación siguiente y eso es una decisión
 * humana, no del webhook.
 */
export async function revertirComision(transactionId: string): Promise<{ revertidas: number }> {
    if (!transactionId) return { revertidas: 0 };
    try {
        const [res] = await pool.query<any>(
            `UPDATE AffiliateCommissions SET status = 'REVERSED'
             WHERE paddle_transaction_id = ? AND status IN ('PENDING', 'APPROVED')`,
            [transactionId]
        );
        const revertidas = Number(res?.affectedRows || 0);
        if (revertidas > 0) console.log(`[affiliates] comisión revertida por reembolso (txn ${transactionId})`);
        return { revertidas };
    } catch (e) {
        console.error(`[affiliates] no se pudo revertir la comisión de la txn ${transactionId}:`, errorMessage(e));
        return { revertidas: 0 };
    }
}

// ---------------------------------------------------------------------------
// Administración (SuperAdmin)
// ---------------------------------------------------------------------------

export interface AfiliadoConMetricas {
    id: string;
    name: string;
    email: string;
    referralCode: string;
    commissionPct: string;
    status: "ACTIVE" | "SUSPENDED" | "PENDING";
    payoutMethod: string | null;
    payoutReference: string | null;
    notes: string | null;
    createdAt: string | null;
    tenantsReferidos: number;
    /** Devengado y todavía sin liquidar (PENDING + APPROVED). */
    pendienteDePago: string;
    yaPagado: string;
    moneda: string | null;
}

/**
 * Los agregados salen de subconsultas y no de un JOIN con GROUP BY: un afiliado
 * con N referidos y M comisiones haría producto cartesiano y los montos
 * saldrían multiplicados por la cantidad de referidos.
 *
 * `moneda` es la del último cobro. Si algún día se cobra en varias monedas al
 * mismo afiliado, sumar sin separar deja de tener sentido y esto tiene que pasar
 * a agrupar por currency — por eso viaja el dato en vez de asumir USD.
 */
export async function listarAfiliados(): Promise<AfiliadoConMetricas[]> {
    const [rows] = await pool.query<any[]>(
        `SELECT a.id, a.name, a.email, a.referral_code, a.commission_pct, a.status,
                a.payout_method, a.payout_reference, a.notes, a.created_at,
                (SELECT COUNT(*) FROM AffiliateReferrals r WHERE r.affiliate_id = a.id) AS tenants_referidos,
                (SELECT COALESCE(SUM(c.commission_amount), 0) FROM AffiliateCommissions c
                   WHERE c.affiliate_id = a.id AND c.status IN ('PENDING', 'APPROVED')) AS pendiente,
                (SELECT COALESCE(SUM(c.commission_amount), 0) FROM AffiliateCommissions c
                   WHERE c.affiliate_id = a.id AND c.status = 'PAID') AS pagado,
                (SELECT c.currency FROM AffiliateCommissions c
                   WHERE c.affiliate_id = a.id ORDER BY c.created_at DESC LIMIT 1) AS moneda
         FROM Affiliates a
         ORDER BY a.created_at DESC`
    );
    return (rows || []).map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        referralCode: r.referral_code,
        commissionPct: String(r.commission_pct),
        status: r.status,
        payoutMethod: r.payout_method,
        payoutReference: r.payout_reference,
        notes: r.notes,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
        tenantsReferidos: Number(r.tenants_referidos || 0),
        pendienteDePago: String(r.pendiente ?? "0"),
        yaPagado: String(r.pagado ?? "0"),
        moneda: r.moneda || null,
    }));
}

export interface ComisionItem {
    id: number;
    affiliateId: string;
    affiliateName: string;
    tenantId: string;
    companyName: string | null;
    transactionId: string;
    baseAmount: string;
    currency: string;
    commissionPct: string;
    commissionAmount: string;
    status: EstadoComision;
    billedAt: string | null;
    createdAt: string | null;
}

export async function listarComisiones(filtro?: {
    affiliateId?: string;
    status?: EstadoComision;
    limite?: number;
}): Promise<ComisionItem[]> {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filtro?.affiliateId) { where.push("c.affiliate_id = ?"); args.push(filtro.affiliateId); }
    if (filtro?.status) { where.push("c.status = ?"); args.push(filtro.status); }
    const limite = Math.max(1, Math.min(500, filtro?.limite || 200));

    const [rows] = await pool.query<any[]>(
        `SELECT c.id, c.affiliate_id, a.name AS affiliate_name, c.tenant_id, t.company_name,
                c.paddle_transaction_id, c.base_amount, c.currency, c.commission_pct,
                c.commission_amount, c.status, c.billed_at, c.created_at
         FROM AffiliateCommissions c
         JOIN Affiliates a ON a.id = c.affiliate_id
         LEFT JOIN Tenants t ON t.tenant_id = c.tenant_id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY c.created_at DESC
         LIMIT ${limite}`,
        args
    );
    return (rows || []).map((r) => ({
        id: Number(r.id),
        affiliateId: r.affiliate_id,
        affiliateName: r.affiliate_name,
        tenantId: r.tenant_id,
        companyName: r.company_name || null,
        transactionId: r.paddle_transaction_id,
        baseAmount: String(r.base_amount),
        currency: r.currency,
        commissionPct: String(r.commission_pct),
        commissionAmount: String(r.commission_amount),
        status: r.status,
        billedAt: r.billed_at ? new Date(r.billed_at).toISOString() : null,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    }));
}

export async function crearAfiliado(datos: {
    name: string;
    email: string;
    referralCode: string;
    commissionPct?: number | string;
    payoutMethod?: string | null;
    payoutReference?: string | null;
    notes?: string | null;
}): Promise<{ id: string }> {
    const codigo = normalizarCodigo(datos.referralCode);
    if (!codigo) throw new Error("El código de referido admite letras, números, guiones y guiones bajos, y arranca con letra o número.");
    const email = String(datos.email || "").trim().toLowerCase();
    if (!email.includes("@")) throw new Error("Email inválido.");
    const nombre = String(datos.name || "").trim();
    if (!nombre) throw new Error("El nombre es obligatorio.");

    const pct = new Decimal(String(datos.commissionPct ?? 20));
    if (pct.lte(0) || pct.gt(100)) throw new Error("El porcentaje de comisión tiene que estar entre 0 y 100.");

    const id = crypto.randomUUID();
    await pool.query(
        `INSERT INTO Affiliates (id, name, email, referral_code, commission_pct, payout_method, payout_reference, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, nombre, email, codigo, pct.toDecimalPlaces(2).toFixed(2),
         datos.payoutMethod || null, datos.payoutReference || null, datos.notes || null]
    );
    return { id };
}

/**
 * Cambia el estado de un lote de comisiones. `PAID` sella `paid_at`.
 *
 * No permite volver a PENDING desde PAID: una vez liquidada, corregir es una
 * operación contable, no un click. El SQL lo restringe además de la UI.
 */
export async function actualizarEstadoComisiones(
    ids: number[],
    estado: EstadoComision
): Promise<{ actualizadas: number }> {
    const limpios = (ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (limpios.length === 0) return { actualizadas: 0 };

    const marcadores = limpios.map(() => "?").join(",");
    const [res] = await pool.query<any>(
        `UPDATE AffiliateCommissions
         SET status = ?, paid_at = ${estado === "PAID" ? "NOW()" : "paid_at"}
         WHERE id IN (${marcadores}) AND status <> 'PAID'`,
        [estado, ...limpios]
    );
    return { actualizadas: Number(res?.affectedRows || 0) };
}
