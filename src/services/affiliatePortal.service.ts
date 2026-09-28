/**
 * El panel del afiliado: lo que ve el partner de SUS propios números.
 *
 * VIVE APARTE DE `affiliates.service.ts` A PROPÓSITO. Aquel es la cara de
 * superadmin —ve a todos los afiliados, todas las comisiones, todos los
 * tenants— y esta es una superficie PÚBLICA a la que se entra con un token, sin
 * pasar por Entra ID. Mezclarlas es cómo una consulta pensada para el panel
 * interno termina sirviéndole a un tercero el identificador de un cliente.
 *
 * QUÉ PUEDE VER EL AFILIADO, que es el límite del §8.1 del borrador legal:
 * sus clientes referidos por NOMBRE DE EMPRESA, sus comisiones y sus estados.
 *
 * QUÉ NO, y por eso esto no reusa `listarComisiones()`:
 *   - `tenant_id`, que es el identificador del directorio de Azure del cliente.
 *   - `paddle_transaction_id`, que referencia la facturación del cliente.
 *   - Cualquier dato de gasto cloud del referido. El afiliado cobra por traerlo,
 *     no accede a lo que ese cliente gasta.
 *
 * La proyección de abajo es la lista blanca. Agregar una columna acá es una
 * decisión sobre datos de un tercero, no un detalle de UI.
 */

import crypto from "crypto";
import pool from "@/modules/storage/db";
import { MESES_DE_COMISION } from "./affiliates.service";
import { sumarMeses } from "./commissions.service";

/** Prefijo del token. `afp` = afiliado · panel. */
const PREFIJO_TOKEN = "afp_live_";

/** SHA-256 del token, que es lo único que se guarda. */
export function hashTokenDePanel(bruto: string): string {
    return crypto.createHash("sha256").update(bruto.trim()).digest("hex");
}

/**
 * Token nuevo. 32 bytes de `randomBytes`: adivinarlo no es un modo de falla
 * realista, y por eso el límite de peticiones de la ruta es contra el abuso, no
 * contra la fuerza bruta.
 */
export function generarTokenDePanel(): { bruto: string; prefijo: string; hash: string } {
    const bruto = `${PREFIJO_TOKEN}${crypto.randomBytes(32).toString("hex")}`;
    return { bruto, prefijo: bruto.slice(0, 14), hash: hashTokenDePanel(bruto) };
}

/** ¿Tiene forma de token de panel? Descarta la basura antes de ir a la base. */
export function pareceTokenDePanel(valor: unknown): valor is string {
    return typeof valor === "string" && /^afp_live_[0-9a-f]{64}$/.test(valor.trim());
}

/**
 * Emite —o rota— el enlace del afiliado. Devuelve el texto plano UNA vez: no se
 * guarda, así que no hay forma de volver a mostrarlo. Emitir de nuevo invalida
 * el anterior, que es también cómo se recupera un enlace filtrado.
 */
export async function emitirEnlaceDePanel(
    affiliateId: string,
): Promise<{ bruto: string; prefijo: string } | null> {
    const { bruto, prefijo, hash } = generarTokenDePanel();
    const [res] = await pool.query<any>(
        `UPDATE Affiliates
            SET portal_token_hash = ?, portal_token_prefix = ?,
                portal_token_issued_at = NOW(), portal_token_last_used_at = NULL
          WHERE id = ?`,
        [hash, prefijo, affiliateId],
    );
    return res?.affectedRows ? { bruto, prefijo } : null;
}

/** Corta el acceso sin tocar al afiliado ni a sus comisiones. */
export async function revocarEnlaceDePanel(affiliateId: string): Promise<boolean> {
    const [res] = await pool.query<any>(
        `UPDATE Affiliates
            SET portal_token_hash = NULL, portal_token_prefix = NULL,
                portal_token_issued_at = NULL, portal_token_last_used_at = NULL
          WHERE id = ?`,
        [affiliateId],
    );
    return !!res?.affectedRows;
}

/**
 * Resuelve el token a un afiliado, o `null`.
 *
 * Exige `status = 'ACTIVE'` por el mismo motivo que el devengo: suspender a un
 * afiliado tiene que cortarle todo, no sólo las comisiones nuevas. Si no, un
 * suspendido seguiría mirando los nombres de los clientes que trajo.
 */
export async function afiliadoPorToken(
    bruto: unknown,
): Promise<{ id: string; nombre: string; codigo: string; pct: string } | null> {
    if (!pareceTokenDePanel(bruto)) return null;
    const [rows] = await pool.query<any[]>(
        `SELECT id, name, referral_code, commission_pct
           FROM Affiliates
          WHERE portal_token_hash = ? AND status = 'ACTIVE' LIMIT 1`,
        [hashTokenDePanel(bruto)],
    );
    const a = Array.isArray(rows) ? rows[0] : null;
    if (!a) return null;
    // Best-effort: que falle el registro de uso no puede dejar sin panel a nadie.
    pool.query(`UPDATE Affiliates SET portal_token_last_used_at = NOW() WHERE id = ?`, [a.id])
        .catch(() => {});
    return { id: a.id, nombre: a.name, codigo: a.referral_code, pct: String(a.commission_pct) };
}

export interface ReferidoDelPanel {
    empresa: string;
    desde: string | null;
    /** Hasta cuándo comisiona este cliente. Ver `MESES_DE_COMISION`. */
    comisionaHasta: string | null;
    cobros: number;
    acumulado: string;
}

export interface ComisionDelPanel {
    empresa: string;
    fecha: string | null;
    base: string;
    moneda: string;
    pct: string;
    monto: string;
    estado: string;
}

export interface PanelAfiliado {
    nombre: string;
    codigo: string;
    pct: string;
    mesesDeComision: number;
    totales: { pendiente: string; pagado: string; moneda: string | null; referidos: number };
    referidos: ReferidoDelPanel[];
    comisiones: ComisionDelPanel[];
}

/**
 * Los números del afiliado. `empresa` sale de `Tenants.company_name` y es lo
 * único que identifica al cliente: ver la nota de arriba sobre qué NO viaja.
 */
export async function panelDelAfiliado(
    afiliado: { id: string; nombre: string; codigo: string; pct: string },
): Promise<PanelAfiliado> {
    const [referidos] = await pool.query<any[]>(
        `SELECT t.company_name AS empresa, r.referred_at AS desde,
                COUNT(c.id) AS cobros,
                COALESCE(SUM(c.commission_amount), 0) AS acumulado,
                MIN(COALESCE(c.billed_at, c.created_at)) AS primer_cobro
           FROM AffiliateReferrals r
           LEFT JOIN Tenants t ON t.tenant_id = r.tenant_id
           LEFT JOIN Commissions c
                  ON c.beneficiary_type = 'affiliate'
                 AND c.beneficiary_id = r.affiliate_id
                 AND c.tenant_id = r.tenant_id
          WHERE r.affiliate_id = ?
          GROUP BY r.tenant_id, t.company_name, r.referred_at
          ORDER BY r.referred_at DESC`,
        [afiliado.id],
    );

    const [comisiones] = await pool.query<any[]>(
        `SELECT t.company_name AS empresa, c.billed_at, c.created_at,
                c.base_amount, c.currency, c.commission_pct, c.commission_amount, c.status
           FROM Commissions c
           LEFT JOIN Tenants t ON t.tenant_id = c.tenant_id
          WHERE c.beneficiary_type = 'affiliate' AND c.beneficiary_id = ?
          ORDER BY COALESCE(c.billed_at, c.created_at) DESC
          LIMIT 200`,
        [afiliado.id],
    );

    const [[tot]] = await pool.query<any[]>(
        `SELECT COALESCE(SUM(CASE WHEN status IN ('PENDING','DUE','APPROVED') THEN commission_amount END), 0) AS pendiente,
                COALESCE(SUM(CASE WHEN status = 'PAID' THEN commission_amount END), 0) AS pagado,
                (SELECT currency FROM Commissions
                  WHERE beneficiary_type = 'affiliate' AND beneficiary_id = ?
                  ORDER BY created_at DESC LIMIT 1) AS moneda
           FROM Commissions
          WHERE beneficiary_type = 'affiliate' AND beneficiary_id = ?`,
        [afiliado.id, afiliado.id],
    ) as any;

    const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

    return {
        nombre: afiliado.nombre,
        codigo: afiliado.codigo,
        pct: afiliado.pct,
        mesesDeComision: MESES_DE_COMISION,
        totales: {
            pendiente: String(tot?.pendiente ?? "0"),
            pagado: String(tot?.pagado ?? "0"),
            moneda: tot?.moneda || null,
            referidos: (referidos || []).length,
        },
        referidos: (referidos || []).map((r) => ({
            empresa: r.empresa || "—",
            desde: iso(r.desde),
            // Sin primer cobro todavía no arrancó la ventana: no hay fecha de
            // fin que prometer, y decir una sería inventarla.
            comisionaHasta: r.primer_cobro
                ? sumarMeses(new Date(r.primer_cobro), MESES_DE_COMISION).toISOString()
                : null,
            cobros: Number(r.cobros || 0),
            acumulado: String(r.acumulado ?? "0"),
        })),
        comisiones: (comisiones || []).map((c) => ({
            empresa: c.empresa || "—",
            fecha: iso(c.billed_at || c.created_at),
            base: String(c.base_amount),
            moneda: c.currency,
            pct: String(c.commission_pct),
            monto: String(c.commission_amount),
            estado: c.status,
        })),
    };
}
