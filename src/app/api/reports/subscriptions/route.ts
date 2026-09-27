/**
 * GET/POST/DELETE /api/reports/subscriptions — MEJ-35.
 *
 * RBAC: ver la lista pide pertenencia al tenant; crearla o borrarla pide
 * Admin/Owner. Una suscripción MANDA CORREO A TERCEROS de forma recurrente:
 * no es una preferencia de pantalla y no es una acción de lectura.
 */

import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantAccess, requireTenantRole } from "@/lib/requestAuth";
import { TIPOS_DE_REPORTE } from "@/services/reportRenderers.service";
import { enviarSuscripcion } from "@/services/reportDispatch.service";
import { errorMessage } from "@/lib/apiErrors";

const FRECUENCIAS = ["daily", "weekly", "monthly"] as const;
const MAX_DESTINATARIOS = 20;

/** Validación de correo deliberadamente simple: el que manda es Graph. */
const pareceCorreo = (s: unknown) => typeof s === "string" && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(s.trim());

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        await requireTenantAccess(request, tenantId);

        const [filas] = await pool.query<any[]>(
            `SELECT id, report_type AS reportType, scope_json AS scope, recipients_json AS recipients,
                    frequency, day_of_week AS dayOfWeek, day_of_month AS dayOfMonth,
                    last_sent_at AS lastSentAt, active, created_by AS createdBy
               FROM ReportSubscriptions
              WHERE tenant_id = ?
              ORDER BY active DESC, id DESC`,
            [tenantId]
        );

        return NextResponse.json({
            success: true,
            tiposDisponibles: TIPOS_DE_REPORTE,
            subscriptions: (filas || []).map((f) => ({
                ...f,
                active: Boolean(f.active),
                scope: f.scope ?? null,
                recipients: f.recipients ?? [],
            })),
        });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[reports/subscriptions] GET:", errorMessage(e));
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const cuerpo = (await request.json().catch(() => ({}))) || {};
        const { tenantId, reportType, scope, recipients, frequency, dayOfWeek, dayOfMonth, enviarAhora } = cuerpo;
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        // Guard inline: `local/no-unauth-tenant-id` está para que la
        // autorización se lea en el handler y no en un helper.
        const identidad = await requireTenantRole(request, tenantId, ["Owner", "Admin"]);

        if (!TIPOS_DE_REPORTE.includes(String(reportType))) {
            return NextResponse.json(
                { error: `reportType debe ser uno de: ${TIPOS_DE_REPORTE.join(", ")}` },
                { status: 400 }
            );
        }
        const destinatarios = Array.isArray(recipients) ? recipients.map((r) => String(r).trim()) : [];
        if (destinatarios.length === 0 || destinatarios.length > MAX_DESTINATARIOS) {
            return NextResponse.json(
                { error: `Se espera entre 1 y ${MAX_DESTINATARIOS} destinatarios` },
                { status: 400 }
            );
        }
        const invalido = destinatarios.find((r) => !pareceCorreo(r));
        if (invalido) {
            return NextResponse.json({ error: `Correo inválido: ${invalido}` }, { status: 400 });
        }
        if (!FRECUENCIAS.includes(String(frequency) as any)) {
            return NextResponse.json({ error: "frequency debe ser daily, weekly o monthly" }, { status: 400 });
        }

        // Una cadencia incompleta NO se guarda: una semanal sin día nunca se
        // manda, y el usuario se entera cuando el correo no llega — que es
        // justamente la falla que no avisa.
        let dow: number | null = null;
        let dom: number | null = null;
        if (frequency === "weekly") {
            dow = Number(dayOfWeek);
            if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
                return NextResponse.json({ error: "Una suscripción semanal necesita dayOfWeek entre 0 y 6" }, { status: 400 });
            }
        }
        if (frequency === "monthly") {
            dom = Number(dayOfMonth);
            if (!Number.isInteger(dom) || dom < 1 || dom > 31) {
                return NextResponse.json({ error: "Una suscripción mensual necesita dayOfMonth entre 1 y 31" }, { status: 400 });
            }
        }

        const [res]: any = await pool.query(
            `INSERT INTO ReportSubscriptions
                 (tenant_id, report_type, scope_json, recipients_json, frequency, day_of_week, day_of_month, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                tenantId, reportType,
                scope ? JSON.stringify(scope) : null,
                JSON.stringify(destinatarios),
                frequency, dow, dom,
                identidad?.email || null,
            ]
        );

        // "Enviar ahora" NO toca `last_sent_at`: es una prueba, y marcarla como
        // enviada saltearía el envío real del período.
        if (enviarAhora) {
            try {
                await enviarSuscripcion({
                    id: Number(res?.insertId || 0),
                    tenantId, reportType: String(reportType),
                    scope: scope || null, recipients: destinatarios,
                }, { marcarEnviado: false });
            } catch (e) {
                return NextResponse.json({
                    success: true, id: res?.insertId,
                    avisoEnvio: `La suscripción se guardó, pero la prueba de envío falló: ${errorMessage(e)}`,
                });
            }
        }

        return NextResponse.json({ success: true, id: res?.insertId });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[reports/subscriptions] POST:", errorMessage(e));
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get("tenantId");
        const id = Number(request.nextUrl.searchParams.get("id"));
        if (!tenantId || !Number.isInteger(id)) {
            return NextResponse.json({ error: "Faltan tenantId o id" }, { status: 400 });
        }
        await requireTenantRole(request, tenantId, ["Owner", "Admin"]);

        // El `tenant_id` en el WHERE no es decorativo: sin él, un id de otro
        // tenant se borraría con sólo ser Admin del propio.
        const [res]: any = await pool.query(
            "DELETE FROM ReportSubscriptions WHERE id = ? AND tenant_id = ?",
            [id, tenantId]
        );
        if (!res?.affectedRows) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
        return NextResponse.json({ success: true });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[reports/subscriptions] DELETE:", errorMessage(e));
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
