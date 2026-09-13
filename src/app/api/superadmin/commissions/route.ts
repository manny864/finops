/**
 * Libro mayor de comisiones y liquidación (MEJ-14, criterios 2 a 4).
 * Auth: requireSuperAdmin — es la plata que se le paga a terceros y al equipo
 * comercial, así que no hay variante mock ni tenant-scoped.
 *
 * GET  ?view=ledger[&type=&beneficiaryId=&tenantId=&status=&limit=]
 *        → el libro, afiliados y comerciales juntos
 * GET  ?view=summary            → cuánto se le debe a cada beneficiario
 * GET  ?view=reps               → comerciales dados de alta
 * GET  ?format=csv              → el libro en CSV para contabilidad
 * POST { action: "pay", ids, paidAt?, reference?, notes? }  → marcar pagadas
 * POST { action: "createRep", name, email, commissionPct? } → alta de comercial
 * POST { action: "assignRep", tenantId, salesRepId }        → atribuir una venta
 */
import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import pool from "@/modules/storage/db";
import Decimal from "decimal.js";
import {
    listarLibroDeComisiones,
    marcarComisionesPagadas,
    resumenPorBeneficiario,
    type EstadoComision,
    type TipoBeneficiario,
} from "@/services/commissions.service";

const ESTADOS: EstadoComision[] = ["PENDING", "DUE", "APPROVED", "PAID", "REVERSED", "CANCELLED"];
const TIPOS: TipoBeneficiario[] = ["affiliate", "sales_rep"];

/** Escapa un campo para CSV: la razón social de un tenant puede traer comas. */
function campoCsv(valor: unknown): string {
    const s = String(valor ?? "");
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: NextRequest) {
    try {
        await requireSuperAdmin(request);
        const { searchParams } = new URL(request.url);
        const view = searchParams.get("view") || "ledger";

        if (view === "summary") {
            return NextResponse.json({ success: true, summary: await resumenPorBeneficiario() });
        }

        if (view === "reps") {
            const [rows] = await pool.query<any[]>(
                `SELECT r.id, r.name, r.email, r.commission_pct, r.status, r.created_at,
                        (SELECT COUNT(*) FROM TenantCommercialDeals d WHERE d.sales_rep_id = r.id) AS ventas
                   FROM SalesReps r ORDER BY r.created_at DESC`
            );
            return NextResponse.json({
                success: true,
                reps: (rows || []).map((r) => ({
                    id: r.id,
                    name: r.name,
                    email: r.email,
                    commissionPct: String(r.commission_pct),
                    status: r.status,
                    ventas: Number(r.ventas || 0),
                    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
                })),
            });
        }

        const estadoCrudo = searchParams.get("status");
        const tipoCrudo = searchParams.get("type");
        const libro = await listarLibroDeComisiones({
            beneficiaryType: TIPOS.includes(tipoCrudo as TipoBeneficiario) ? (tipoCrudo as TipoBeneficiario) : undefined,
            beneficiaryId: searchParams.get("beneficiaryId") || undefined,
            tenantId: searchParams.get("tenantId") || undefined,
            status: ESTADOS.includes(estadoCrudo as EstadoComision) ? (estadoCrudo as EstadoComision) : undefined,
            limite: Number(searchParams.get("limit")) || undefined,
        });

        if (searchParams.get("format") === "csv") {
            const cabecera = [
                "id", "tipo", "beneficiario", "tenant", "empresa", "transaccion", "base",
                "moneda", "porcentaje", "comision", "cuota", "estado", "vence", "pagada_el", "comprobante",
            ].join(",");
            const filas = libro.map((c) =>
                [
                    c.id, c.beneficiaryType, c.beneficiaryName, c.tenantId, c.companyName, c.transactionId,
                    c.baseAmount, c.currency, c.commissionPct, c.commissionAmount, c.installment,
                    c.status, c.paymentDueDate, c.paidAt, c.paymentReference,
                ].map(campoCsv).join(",")
            );
            return new NextResponse([cabecera, ...filas].join("\n"), {
                headers: {
                    "Content-Type": "text/csv; charset=utf-8",
                    "Content-Disposition": `attachment; filename="comisiones-${new Date().toISOString().slice(0, 10)}.csv"`,
                },
            });
        }

        return NextResponse.json({ success: true, ledger: libro });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        }
        console.error("[superadmin/commissions] GET:", errorMessage(error));
        return NextResponse.json({ error: "No se pudo leer el libro de comisiones." }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const identity = await requireSuperAdmin(request);
        const body = await request.json();
        const action = String(body?.action || "");

        if (action === "pay") {
            const { pagadas } = await marcarComisionesPagadas(body.ids, {
                paidAt: body.paidAt,
                reference: body.reference,
                notes: body.notes,
                adminEmail: identity.email,
            });
            return NextResponse.json({ success: true, pagadas });
        }

        if (action === "createRep") {
            const nombre = String(body.name || "").trim();
            const email = String(body.email || "").trim().toLowerCase();
            if (!nombre) return NextResponse.json({ error: "El nombre es obligatorio." }, { status: 400 });
            if (!email.includes("@")) return NextResponse.json({ error: "Email inválido." }, { status: 400 });

            const pct = new Decimal(String(body.commissionPct ?? 20));
            if (pct.lte(0) || pct.gt(100)) {
                return NextResponse.json({ error: "El porcentaje tiene que estar entre 0 y 100." }, { status: 400 });
            }

            const id = crypto.randomUUID();
            await pool.query(
                `INSERT INTO SalesReps (id, name, email, commission_pct, payout_method, payout_reference, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, nombre, email, pct.toDecimalPlaces(2).toFixed(2),
                 body.payoutMethod || null, body.payoutReference || null, body.notes || null]
            );
            return NextResponse.json({ success: true, id });
        }

        if (action === "assignRep") {
            const tenantId = String(body.tenantId || "").trim();
            const salesRepId = String(body.salesRepId || "").trim();
            if (!tenantId || !salesRepId) {
                return NextResponse.json({ error: "tenantId y salesRepId son requeridos." }, { status: 400 });
            }

            // El acuerdo tiene que existir: ahí viven `sold_at` y `contract_term`,
            // sin los cuales no hay devengamiento posible. Se crea desde la ficha
            // comercial del tenant, no desde acá.
            const [res] = await pool.query<any>(
                `UPDATE TenantCommercialDeals SET sales_rep_id = ? WHERE tenant_id = ?`,
                [salesRepId, tenantId]
            );
            if (!res?.affectedRows) {
                return NextResponse.json(
                    { error: "Ese tenant todavía no tiene acuerdo comercial cargado (vendedor, fecha de venta y plazo)." },
                    { status: 404 }
                );
            }
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: `Acción no reconocida: ${action}` }, { status: 400 });
    } catch (error) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        }
        console.error("[superadmin/commissions] POST:", errorMessage(error));
        return NextResponse.json({ error: errorMessage(error) || "No se pudo completar la operación." }, { status: 500 });
    }
}
