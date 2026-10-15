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
 * GET  ?view=runs               → corridas de pago
 * GET  ?view=run&id=[&format=csv] → una corrida y sus líneas (CSV = orden de pago)
 * GET  ?view=runPreview&currency=&min= → qué entraría en una corrida, sin crearla
 * POST { action: "pay", ids, paidAt?, reference?, notes? }  → marcar pagadas
 * POST { action: "createRep", name, email, commissionPct?, locale? } → alta de comercial,
 *        con su enlace de panel y el mail de bienvenida
 * POST { action: "assignRep", tenantId, salesRepId }        → atribuir una venta (se ve también
 *        en Gestión de Tenants: el acuerdo toma el nombre y el % del comercial)
 * POST { action: "repPortalLink", id }    → emite (o rota) el enlace del panel del comercial
 * POST { action: "revokeRepPortal", id }  → lo revoca
 * POST { action: "createRun", currency, minimo?, notes? }   → arma la corrida
 * POST { action: "payRun", id, paidAt?, reference?, referencias? } → la confirma
 * POST { action: "cancelRun", id }                          → la cancela y libera
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
import {
    previsualizarCorrida, crearCorrida, detalleCorrida, listarCorridas,
    marcarCorridaPagada, cancelarCorrida,
} from "@/services/payoutRuns.service";
import {
    emitirEnlaceDePanelComercial,
    revocarEnlaceDePanelComercial,
    urlDelPanel,
} from "@/services/affiliatePortal.service";
import { enviarBienvenidaPartner } from "@/services/affiliates.service";
import { urlPublica } from "@/lib/urlPublica";
import { csvEscape } from "@/lib/csvExport";

const ESTADOS: EstadoComision[] = ["PENDING", "DUE", "APPROVED", "PAID", "REVERSED", "CANCELLED"];
const TIPOS: TipoBeneficiario[] = ["affiliate", "sales_rep"];

/** Escapa un campo para CSV: la razón social puede traer comas o empezar con `=` (AISEC-07). */
const campoCsv = csvEscape;

export async function GET(request: NextRequest) {
    try {
        await requireSuperAdmin(request);
        const { searchParams } = new URL(request.url);
        const view = searchParams.get("view") || "ledger";

        if (view === "summary") {
            return NextResponse.json({ success: true, summary: await resumenPorBeneficiario() });
        }

        if (view === "runs") {
            return NextResponse.json({ success: true, runs: await listarCorridas() });
        }

        if (view === "runPreview") {
            const lineas = await previsualizarCorrida({
                currency: (searchParams.get("currency") || "USD").toUpperCase(),
                minimo: searchParams.get("min") || 0,
            });
            return NextResponse.json({ success: true, lineas });
        }

        if (view === "run") {
            const corrida = await detalleCorrida(Number(searchParams.get("id")));
            if (!corrida) return NextResponse.json({ error: "La corrida no existe." }, { status: 404 });

            if (searchParams.get("format") === "csv") {
                // LA ORDEN DE PAGO: una fila por beneficiario, con cuánto y por
                // dónde. `referencia` es el id de la línea y es el que hay que
                // conservar para conciliar el comprobante.
                const cabecera = [
                    "referencia", "tipo", "beneficiario", "email", "medio_de_pago",
                    "datos_de_pago", "comisiones", "moneda", "monto",
                ].join(",");
                const filas = corrida.lineas.map((l) => [
                    l.referencia, l.beneficiaryType, l.nombre, l.email, l.payoutMethod,
                    l.payoutReference, l.comisiones, corrida.currency, l.monto,
                ].map(campoCsv).join(","));
                return new NextResponse([cabecera, ...filas].join("\n"), {
                    headers: {
                        "Content-Type": "text/csv; charset=utf-8",
                        "Content-Disposition": `attachment; filename="corrida-${corrida.id}-${corrida.currency}.csv"`,
                    },
                });
            }
            return NextResponse.json({ success: true, run: corrida });
        }

        if (view === "reps") {
            const [rows] = await pool.query<any[]>(
                `SELECT r.id, r.name, r.email, r.commission_pct, r.status, r.created_at, r.portal_token_prefix,
                        (SELECT COUNT(*) FROM TenantCommercialDeals d WHERE d.sales_rep_id = r.id) AS ventas,
                        -- Mismo email que un afiliado: el panel le junta los dos programas.
                        EXISTS (SELECT 1 FROM Affiliates a WHERE LOWER(a.email) = LOWER(r.email)) AS tambien_afiliado
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
                    portalPrefix: r.portal_token_prefix || null,
                    tambienAfiliado: Boolean(Number(r.tambien_afiliado)),
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
            // `email`, `medio_de_pago` y `datos_de_pago` van en el CSV porque
            // este archivo ES la orden de pago: sin ellos dice a quién y cuánto,
            // pero no por dónde, y hay que ir a buscar los datos de cada persona
            // a otra pantalla para poder transferir.
            const cabecera = [
                "id", "tipo", "beneficiario", "email", "medio_de_pago", "datos_de_pago",
                "tenant", "empresa", "transaccion", "base",
                "moneda", "porcentaje", "comision", "cuota", "estado", "vence", "pagada_el", "comprobante",
            ].join(",");
            const filas = libro.map((c) =>
                [
                    c.id, c.beneficiaryType, c.beneficiaryName, c.beneficiaryEmail,
                    c.payoutMethod, c.payoutReference,
                    c.tenantId, c.companyName, c.transactionId,
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

        if (action === "createRun") {
            const corrida = await crearCorrida({
                currency: String(body.currency || "USD").toUpperCase(),
                minimo: body.minimo,
                notes: body.notes || null,
                adminEmail: identity.email,
            });
            if (!corrida) {
                return NextResponse.json({ error: "nothingToPay" }, { status: 409 });
            }
            return NextResponse.json({ success: true, run: corrida });
        }

        if (action === "payRun") {
            const r = await marcarCorridaPagada(Number(body.id), {
                adminEmail: identity.email,
                paidAt: body.paidAt,
                reference: body.reference,
                referencias: body.referencias,
            });
            // null = la corrida no estaba abierta. No es un error del pedido:
            // confirmar dos veces la misma corrida tiene que ser inocuo.
            if (!r) return NextResponse.json({ error: "runNotOpen" }, { status: 409 });
            return NextResponse.json({ success: true, pagadas: r.pagadas });
        }

        if (action === "cancelRun") {
            const ok = await cancelarCorrida(Number(body.id));
            if (!ok) return NextResponse.json({ error: "runNotOpen" }, { status: 409 });
            return NextResponse.json({ success: true });
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
            // Su panel (2026-10-06): el comercial también tiene enlace, y le llega
            // por mail como al afiliado. Si además es afiliado (mismo email), el
            // panel le junta los dos programas. Si el mail no sale, el enlace
            // vuelve en la respuesta y la pantalla lo muestra una vez.
            const base = urlPublica(request);
            const emitido = await emitirEnlaceDePanelComercial(id);
            const portalUrl = emitido ? urlDelPanel(base, emitido.bruto) : null;
            const mail = portalUrl
                ? await enviarBienvenidaPartner({
                    rol: "comercial",
                    nombre,
                    email,
                    linkPanel: portalUrl,
                    locale: typeof body.locale === "string" ? body.locale : undefined,
                })
                : { enviado: false, error: "No se pudo emitir el enlace del panel." };
            return NextResponse.json({ success: true, id, portalUrl, mailEnviado: mail.enviado, mailError: mail.error });
        }

        if (action === "assignRep") {
            const tenantId = String(body.tenantId || "").trim();
            const salesRepId = String(body.salesRepId || "").trim();
            if (!tenantId || !salesRepId) {
                return NextResponse.json({ error: "tenantId y salesRepId son requeridos." }, { status: 400 });
            }
            const [reps] = await pool.query<any[]>(
                `SELECT id, name, commission_pct FROM SalesReps WHERE id = ? LIMIT 1`,
                [salesRepId]
            );
            const rep = Array.isArray(reps) ? reps[0] : null;
            if (!rep) return NextResponse.json({ error: "El comercial no existe." }, { status: 404 });
            // Se refleja en Gestión de Tenants (2026-10-06): el acuerdo toma el
            // nombre y el % del comercial, que es lo que esa pantalla muestra y lo
            // que usa el devengo. Antes sólo se escribía sales_rep_id, y el
            // acuerdo seguía diciendo "Directo SuperAdmin" al 0 %.
            //
            // El acuerdo tiene que existir: ahí viven `sold_at` y `contract_term`,
            // sin los cuales no hay devengamiento posible. Se crea desde la ficha
            // comercial del tenant (Gestión de Tenants), no desde acá.
            const [res] = await pool.query<any>(
                `UPDATE TenantCommercialDeals
                    SET sales_rep_id = ?, sales_rep_name = ?, sales_commission_percent = ?
                  WHERE tenant_id = ?`,
                [rep.id, rep.name, String(rep.commission_pct), tenantId]
            );
            if (!res?.affectedRows) {
                return NextResponse.json(
                    { error: "Ese tenant todavía no tiene acuerdo comercial: cargalo en Gestión de Tenants (vendedor, fecha de venta y plazo)." },
                    { status: 404 }
                );
            }
            return NextResponse.json({ success: true });
        }
        if (action === "repPortalLink") {
            const id = String(body.id || "").trim();
            if (!id) return NextResponse.json({ error: "Falta el id del comercial." }, { status: 400 });
            const emitido = await emitirEnlaceDePanelComercial(id);
            if (!emitido) return NextResponse.json({ error: "El comercial no existe." }, { status: 404 });
            // UNA sola vez: lo que queda guardado es el hash, como con el afiliado.
            return NextResponse.json({
                success: true,
                prefix: emitido.prefijo,
                url: urlDelPanel(urlPublica(request), emitido.bruto),
            });
        }
        if (action === "revokeRepPortal") {
            const id = String(body.id || "").trim();
            if (!id) return NextResponse.json({ error: "Falta el id del comercial." }, { status: 400 });
            if (!(await revocarEnlaceDePanelComercial(id))) {
                return NextResponse.json({ error: "El comercial no existe." }, { status: 404 });
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
