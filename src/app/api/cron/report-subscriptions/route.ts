/**
 * GET /api/cron/report-subscriptions — MEJ-35.
 *
 * UN SOLO EVALUADOR para todas las suscripciones, no un cron por tipo de
 * reporte: ya hay 26 jobs y sumar uno por reporte no escala. Corre cada hora y
 * decide cuáles vencen; la decisión vive en `reportSubscriptions.service.ts`,
 * que es puro y tiene sus tests.
 *
 * Agendado con `Authorization: Bearer $CRON_SECRET`, igual que el resto.
 */

import { NextRequest, NextResponse } from "next/server";
import { cronSecretForJob } from "@/lib/cronJobSecret";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { recordCronRun } from "@/lib/cronRunTracker";
import { correspondeEnviar, type Suscripcion } from "@/services/reportSubscriptions.service";
import { enviarSuscripcion } from "@/services/reportDispatch.service";
import { DEFAULT_TIMEZONE, isValidTimeZone } from "@/lib/timezone";
import { errorMessage } from "@/lib/apiErrors";

export async function GET(request: NextRequest) {
    const startedAt = Date.now();
    try {
        const cronSecret = cronSecretForJob("report-subscriptions");
        if (!cronSecret || cronSecret.length < 16) {
            console.error("CRON_SECRET not configured or too short");
            return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
        }
        if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        await initializeDatabase();
        const ahora = new Date();

        /**
         * Se traen la zona del tenant y el estado del que la creó.
         *
         * El JOIN con `Users` es el criterio 4: una suscripción de alguien dado
         * de baja no sigue mandando. Es `LEFT JOIN` a propósito — una creada por
         * un proceso, sin fila en `Users`, no se cancela sola; lo que se corta es
         * la de un usuario que EXISTE y ya no está activo.
         */
        const [filas] = await pool.query<any[]>(
            `SELECT rs.id, rs.tenant_id AS tenantId, rs.report_type AS reportType,
                    rs.scope_json AS scope, rs.recipients_json AS recipients,
                    rs.frequency, rs.day_of_week AS dayOfWeek, rs.day_of_month AS dayOfMonth,
                    rs.last_sent_at AS lastSentAt, rs.created_by AS createdBy,
                    t.timezone AS zona,
                    u.account_status AS estadoDelAutor
               FROM ReportSubscriptions rs
               JOIN Tenants t ON t.tenant_id = rs.tenant_id
               LEFT JOIN Users u ON u.tenant_id = rs.tenant_id AND u.email = rs.created_by
              WHERE rs.active = 1`
        );

        let evaluadas = 0, enviadas = 0, omitidasSinDatos = 0, canceladasPorBaja = 0;

        for (const f of filas || []) {
            evaluadas += 1;

            if (f.createdBy && f.estadoDelAutor && String(f.estadoDelAutor).toUpperCase() !== "ACTIVE") {
                // Se desactiva, no se borra: alguien tiene que poder ver por qué
                // dejó de llegar el reporte.
                await pool.query("UPDATE ReportSubscriptions SET active = 0 WHERE id = ?", [f.id]);
                canceladasPorBaja += 1;
                continue;
            }

            const zona = isValidTimeZone(f.zona) ? String(f.zona) : DEFAULT_TIMEZONE;
            const sub: Suscripcion = {
                id: f.id,
                frequency: f.frequency,
                dayOfWeek: f.dayOfWeek === null ? null : Number(f.dayOfWeek),
                dayOfMonth: f.dayOfMonth === null ? null : Number(f.dayOfMonth),
                lastSentAt: f.lastSentAt ? new Date(f.lastSentAt) : null,
            };

            const decision = correspondeEnviar(sub, ahora, zona);
            if (!decision.debe) continue;

            try {
                const r = await enviarSuscripcion({
                    id: f.id,
                    tenantId: f.tenantId,
                    reportType: f.reportType,
                    scope: f.scope ?? null,
                    recipients: Array.isArray(f.recipients) ? f.recipients : [],
                }, { marcarEnviado: true, periodo: decision.periodo });

                if (r.omitido === "sin-datos") omitidasSinDatos += 1;
                else enviadas += r.enviados;
            } catch (e) {
                // Una suscripción que falla no se lleva puestas las demás.
                console.error(`[cron/report-subscriptions] sub ${f.id}:`, errorMessage(e));
            }
        }

        const resumen = { evaluadas, enviadas, omitidasSinDatos, canceladasPorBaja };
        await recordCronRun({
            cronName: "report-subscriptions",
            // "warning" y no "ok" cuando algo quedó sin mandar por falta de
            // datos: un cron verde con reportes que no salieron no se mira.
            status: omitidasSinDatos > 0 ? "warning" : "ok",
            durationMs: Date.now() - startedAt,
            summary: `${enviadas} enviados, ${evaluadas} evaluadas`,
            details: resumen,
        });
        console.log("[cron/report-subscriptions]", resumen);
        return NextResponse.json({ success: true, ...resumen });
    } catch (e) {
        await recordCronRun({
            cronName: "report-subscriptions",
            status: "error",
            durationMs: Date.now() - startedAt,
            summary: errorMessage(e),
        });
        console.error("[cron/report-subscriptions] error:", errorMessage(e));
        return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
    }
}
