/**
 * El panel del partner: lo que ve de SUS propios números quien trae clientes
 * (afiliado, 15 %) o cierra ventas (comercial, 20 %), o las dos cosas. Desde el
 * 2026-10-06 la misma persona ve los dos programas juntos, reconocida por email.
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
import Decimal from "decimal.js";
import type { Pool, PoolConnection } from "mysql2/promise";
import pool from "@/modules/storage/db";
import { MESES_DE_COMISION } from "./affiliates.service";
import {
    sumarMeses,
    sqlPrimerPagoDelTenant,
    promoverComisionesExigibles,
    CUOTAS_MENSUALES,
} from "./commissions.service";

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
 * Las dos tablas con enlace de panel: el afiliado y, desde el 2026-10-06, el
 * comercial. Lista cerrada a propósito: el nombre se interpola en el SQL y
 * nunca sale de un request.
 */
type TablaConPanel = "Affiliates" | "SalesReps";

/**
 * Emite —o rota— el enlace. Devuelve el texto plano UNA vez: no se guarda, así
 * que no hay forma de volver a mostrarlo. Emitir de nuevo invalida el anterior,
 * que es también cómo se recupera un enlace filtrado.
 */
async function emitirEn(tabla: TablaConPanel, id: string): Promise<{ bruto: string; prefijo: string } | null> {
    const { bruto, prefijo, hash } = generarTokenDePanel();
    const [res] = await pool.query<any>(
        `UPDATE ${tabla}
            SET portal_token_hash = ?, portal_token_prefix = ?,
                portal_token_issued_at = NOW(), portal_token_last_used_at = NULL
          WHERE id = ?`,
        [hash, prefijo, id],
    );
    return res?.affectedRows ? { bruto, prefijo } : null;
}

/** Corta el acceso sin tocar a la persona ni a sus comisiones. */
async function revocarEn(tabla: TablaConPanel, id: string): Promise<boolean> {
    const [res] = await pool.query<any>(
        `UPDATE ${tabla}
            SET portal_token_hash = NULL, portal_token_prefix = NULL,
                portal_token_issued_at = NULL, portal_token_last_used_at = NULL
          WHERE id = ?`,
        [id],
    );
    return !!res?.affectedRows;
}

export const emitirEnlaceDePanel = (affiliateId: string) => emitirEn("Affiliates", affiliateId);
export const revocarEnlaceDePanel = (affiliateId: string) => revocarEn("Affiliates", affiliateId);
export const emitirEnlaceDePanelComercial = (salesRepId: string) => emitirEn("SalesReps", salesRepId);
export const revocarEnlaceDePanelComercial = (salesRepId: string) => revocarEn("SalesReps", salesRepId);

type Ejecutor = Pool | PoolConnection;

/** Quién mira el panel: la misma persona en uno o en los dos programas. */
export interface PartnerDelPanel {
    nombre: string;
    afiliado: { id: string; codigo: string; pct: string } | null;
    comercial: { id: string; pct: string } | null;
}

/**
 * Resuelve el token a una persona, o `null`.
 *
 * El token puede ser del afiliado o del comercial, y la MISMA persona en los
 * dos programas se reconoce por el email (decisión 2026-10-06: los dos son
 * únicos en su tabla). Con cualquiera de sus enlaces ve todo lo suyo.
 *
 * Exige `status = 'ACTIVE'` en cada lado por el mismo motivo que el devengo:
 * suspender tiene que cortar todo, no sólo las comisiones nuevas. Un afiliado
 * suspendido que además es comercial activo sigue viendo sus ventas directas,
 * pero no los clientes que trajo.
 */
export async function partnerPorToken(bruto: unknown, ejecutor: Ejecutor = pool): Promise<PartnerDelPanel | null> {
    if (!pareceTokenDePanel(bruto)) return null;
    const hash = hashTokenDePanel(bruto);
    let dueno: { tabla: TablaConPanel; id: string; email: string } | null = null;
    for (const tabla of ["Affiliates", "SalesReps"] as const) {
        const [rows] = await ejecutor.query<any[]>(
            `SELECT id, email FROM ${tabla} WHERE portal_token_hash = ? AND status = 'ACTIVE' LIMIT 1`,
            [hash],
        );
        const fila = Array.isArray(rows) ? rows[0] : null;
        if (fila) {
            dueno = { tabla, id: fila.id, email: String(fila.email || "").trim().toLowerCase() };
            break;
        }
    }
    if (!dueno) return null;
    // Best-effort: que falle el registro de uso no puede dejar sin panel a nadie.
    ejecutor.query(`UPDATE ${dueno.tabla} SET portal_token_last_used_at = NOW() WHERE id = ?`, [dueno.id])
        .catch(() => {});

    const [afiliados] = await ejecutor.query<any[]>(
        `SELECT id, name, referral_code, commission_pct FROM Affiliates
          WHERE LOWER(email) = ? AND status = 'ACTIVE' LIMIT 1`,
        [dueno.email],
    );
    const [comerciales] = await ejecutor.query<any[]>(
        `SELECT id, name, commission_pct FROM SalesReps
          WHERE LOWER(email) = ? AND status = 'ACTIVE' LIMIT 1`,
        [dueno.email],
    );
    const a = Array.isArray(afiliados) ? afiliados[0] : null;
    const r = Array.isArray(comerciales) ? comerciales[0] : null;
    if (!a && !r) return null;
    return {
        nombre: a?.name || r?.name,
        afiliado: a ? { id: a.id, codigo: a.referral_code, pct: String(a.commission_pct) } : null,
        comercial: r ? { id: r.id, pct: String(r.commission_pct) } : null,
    };
}

export interface ReferidoDelPanel {
    empresa: string;
    desde: string | null;
    /** Hasta cuándo comisiona este cliente. Ver `MESES_DE_COMISION`. */
    comisionaHasta: string | null;
    cobros: number;
    acumulado: string;
}

export interface VentaDirectaDelPanel {
    empresa: string;
    /** La fecha de venta del acuerdo comercial; null si no se registró. */
    fechaVenta: string | null;
    contrato: "annual" | "monthly";
    /** Cuotas devengadas sobre el total del contrato, ej. "3/12". */
    cuotas: string;
    acumulado: string;
}

export interface ComisionDelPanel {
    empresa: string;
    programa: "referido" | "directo";
    fecha: string | null;
    /** Desde cuándo es exigible (la fecha de venta manda en los dos programas). */
    exigibleDesde: string | null;
    base: string;
    moneda: string;
    pct: string;
    monto: string;
    estado: string;
}

export interface MontosDelPanel { pendiente: string; pagado: string; ganado: string }

export interface TotalesDelPanel {
    moneda: string;
    referidos: MontosDelPanel;
    directo: MontosDelPanel;
    total: MontosDelPanel;
}

export interface PanelPartner {
    nombre: string;
    afiliado: { codigo: string; pct: string } | null;
    comercial: { pct: string } | null;
    mesesDeComision: number;
    totales: TotalesDelPanel[];
    referidos: ReferidoDelPanel[];
    ventasDirectas: VentaDirectaDelPanel[];
    comisiones: ComisionDelPanel[];
}

const ESTADOS_PENDIENTES = new Set(["PENDING", "DUE", "APPROVED"]);

/**
 * La sumatoria de ganancias, por moneda: no se suman pesos con dólares.
 * Pendiente es lo devengado sin pagar (PENDING, DUE, APPROVED), pagado es PAID
 * y ganado, las dos cosas. Lo revertido y lo cancelado no es ganancia. Con
 * Decimal y no con Number, porque es plata.
 */
export function sumarGanancias(
    filas: Array<{ currency: string; beneficiary_type: string; status: string; monto: unknown }>,
): TotalesDelPanel[] {
    type Par = [Decimal, Decimal];
    const cero = (): Par => [new Decimal(0), new Decimal(0)];
    const porMoneda = new Map<string, { referidos: Par; directo: Par }>();
    for (const f of filas || []) {
        const pendiente = ESTADOS_PENDIENTES.has(f.status);
        if (!pendiente && f.status !== "PAID") continue;
        const m = porMoneda.get(f.currency) ?? { referidos: cero(), directo: cero() };
        const programa = f.beneficiary_type === "sales_rep" ? m.directo : m.referidos;
        const i = pendiente ? 0 : 1;
        programa[i] = programa[i].plus(new Decimal(String(f.monto ?? 0)));
        porMoneda.set(f.currency, m);
    }
    const montos = ([p, g]: Par): MontosDelPanel => ({
        pendiente: p.toFixed(2), pagado: g.toFixed(2), ganado: p.plus(g).toFixed(2),
    });
    return [...porMoneda.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([moneda, m]) => ({
            moneda,
            referidos: montos(m.referidos),
            directo: montos(m.directo),
            total: montos([m.referidos[0].plus(m.directo[0]), m.referidos[1].plus(m.directo[1])]),
        }));
}

/**
 * Los números de la persona en los dos programas. `empresa` sale de
 * `Tenants.company_name` y es lo único que identifica al cliente: ver la nota
 * de arriba sobre qué NO viaja.
 */
export async function panelDelPartner(p: PartnerDelPanel): Promise<PanelPartner> {
    // Que lo vencido figure como Exigible sin esperar a que alguien abra el libro.
    await promoverComisionesExigibles();
    const idAfiliado = p.afiliado?.id ?? "";
    const idComercial = p.comercial?.id ?? "";
    const DE_LA_PERSONA = `((c.beneficiary_type = 'affiliate' AND c.beneficiary_id = ?)
                         OR (c.beneficiary_type = 'sales_rep' AND c.beneficiary_id = ?))`;
    const VIGENTE = `c.status NOT IN ('REVERSED', 'CANCELLED')`;

    const referidos: any[] = p.afiliado
        ? ((await pool.query<any[]>(
            `SELECT t.company_name AS empresa, r.referred_at AS desde,
                    COUNT(CASE WHEN ${VIGENTE} THEN 1 END) AS cobros,
                    COALESCE(SUM(CASE WHEN ${VIGENTE} THEN c.commission_amount END), 0) AS acumulado,
                    ${sqlPrimerPagoDelTenant("r.tenant_id")} AS primer_cobro
               FROM AffiliateReferrals r
               LEFT JOIN Tenants t ON t.tenant_id = r.tenant_id
               LEFT JOIN Commissions c
                      ON c.beneficiary_type = 'affiliate'
                     AND c.beneficiary_id = r.affiliate_id
                     AND c.tenant_id = r.tenant_id
              WHERE r.affiliate_id = ?
              GROUP BY r.tenant_id, t.company_name, r.referred_at
              ORDER BY r.referred_at DESC`,
            [idAfiliado],
        ))[0] as any[])
        : [];

    const ventas: any[] = p.comercial
        ? ((await pool.query<any[]>(
            `SELECT t.company_name AS empresa, d.sold_at, d.contract_term,
                    COUNT(CASE WHEN ${VIGENTE} THEN 1 END) AS cuotas,
                    COALESCE(SUM(CASE WHEN ${VIGENTE} THEN c.commission_amount END), 0) AS acumulado
               FROM TenantCommercialDeals d
               LEFT JOIN Tenants t ON t.tenant_id = d.tenant_id
               LEFT JOIN Commissions c
                      ON c.beneficiary_type = 'sales_rep'
                     AND c.beneficiary_id = d.sales_rep_id
                     AND c.tenant_id = d.tenant_id
              WHERE d.sales_rep_id = ?
              GROUP BY d.tenant_id, t.company_name, d.sold_at, d.contract_term
              ORDER BY d.sold_at IS NULL, d.sold_at DESC`,
            [idComercial],
        ))[0] as any[])
        : [];

    const [comisiones] = await pool.query<any[]>(
        `SELECT t.company_name AS empresa, c.beneficiary_type, c.billed_at, c.created_at, c.payment_due_date,
                c.base_amount, c.currency, c.commission_pct, c.commission_amount, c.status
           FROM Commissions c
           LEFT JOIN Tenants t ON t.tenant_id = c.tenant_id
          WHERE ${DE_LA_PERSONA}
          ORDER BY COALESCE(c.billed_at, c.created_at) DESC
          LIMIT 200`,
        [idAfiliado, idComercial],
    );

    const [montos] = await pool.query<any[]>(
        `SELECT c.currency, c.beneficiary_type, c.status, SUM(c.commission_amount) AS monto
           FROM Commissions c
          WHERE ${DE_LA_PERSONA}
          GROUP BY c.currency, c.beneficiary_type, c.status`,
        [idAfiliado, idComercial],
    );

    const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

    return {
        nombre: p.nombre,
        afiliado: p.afiliado ? { codigo: p.afiliado.codigo, pct: p.afiliado.pct } : null,
        comercial: p.comercial ? { pct: p.comercial.pct } : null,
        mesesDeComision: MESES_DE_COMISION,
        totales: sumarGanancias(montos || []),
        referidos: referidos.map((r) => ({
            empresa: r.empresa || "—",
            desde: iso(r.desde),
            // Sin primer pago todavía no arrancó la ventana: no hay fecha de
            // fin que prometer, y decir una sería inventarla.
            comisionaHasta: r.primer_cobro
                ? sumarMeses(new Date(r.primer_cobro), MESES_DE_COMISION).toISOString()
                : null,
            cobros: Number(r.cobros || 0),
            acumulado: String(r.acumulado ?? "0"),
        })),
        ventasDirectas: ventas.map((v) => ({
            empresa: v.empresa || "—",
            fechaVenta: iso(v.sold_at),
            contrato: v.contract_term === "annual" ? "annual" : "monthly",
            cuotas: `${Number(v.cuotas || 0)}/${v.contract_term === "annual" ? 1 : CUOTAS_MENSUALES}`,
            acumulado: String(v.acumulado ?? "0"),
        })),
        comisiones: (comisiones || []).map((c) => ({
            empresa: c.empresa || "—",
            programa: c.beneficiary_type === "sales_rep" ? "directo" : "referido",
            fecha: iso(c.billed_at || c.created_at),
            exigibleDesde: iso(c.payment_due_date),
            base: String(c.base_amount),
            moneda: c.currency,
            pct: String(c.commission_pct),
            monto: String(c.commission_amount),
            estado: c.status,
        })),
    };
}
