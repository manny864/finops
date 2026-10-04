import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { errorMessage, serverError } from "@/lib/apiErrors";
import { getAzureCredential } from "@/lib/azure";
import { getAccessModel } from "@/lib/lighthouseAccess";
import { isMockTenant } from "@/lib/mockData";
import { hasAccess } from "@/lib/tierLogic";
import { getRequiredTierForPath } from "@/lib/routeTiers";
import { addonUnlocksPath } from "@/lib/addonCatalog";
import { TenantAddonsService } from "@/services/tenantAddons.service";
import { getActiveReservations } from "@/services/reservationService";
import {
    avisosDeVencimiento, gravedad, textoDelAviso, type AvisoDeVencimiento,
} from "@/services/reservationExpiryAlerts.service";
import { createNotification } from "@/lib/notify";
import { notifyTenant } from "@/lib/notifications";
import { recordCronRun } from "@/lib/cronRunTracker";
import { urlPublica } from "@/lib/urlPublica";

/**
 * MEJ-16, criterio 3 — avisos de vencimiento de reservas a 90, 60 y 30 días.
 * La lógica de escalones vive en `reservationExpiryAlerts.service.ts`.
 *
 * AUTOMÁTICO, SIN REGLA. A diferencia de credenciales o TTL, acá no hay umbral
 * que elegir: los tres escalones son los de la propuesta. Avisa por la
 * campanita y por los canales que el tenant ya configuró en Notificaciones
 * (Slack, Teams, email, webhook), con su interruptor maestro y su filtro de
 * severidad.
 *
 * LA MISMA FUENTE QUE LA PESTAÑA DE RESERVAS (`getActiveReservations`): si el
 * cliente no ve sus reservas ahí —le falta "Reservations Reader" sobre
 * /providers/Microsoft.Capacity—, tampoco recibe estos avisos.
 *
 * ponytail: secuencial, una llamada a ARM por tenant. Anda con decenas de
 * tenants; si el barrido se acerca a los ~240 s que tolera el ingress, pasarlo
 * a `async_poll` como `anomaly-detection`.
 */
const JOB = "reservation-expiry-alerts";

/** La pestaña donde el cliente ve sus reservas. El aviso lleva ahí. */
const PANTALLA = "/intelligence/optimizacion-y-ahorro/reservas-de-instancias-ris";

/** Sólo avisa a quien tiene la pantalla: por plan o por el módulo comprado. */
async function tieneLaPantalla(tenantId: string, tier: string): Promise<boolean> {
    const requerido = getRequiredTierForPath(PANTALLA);
    if (!requerido || hasAccess(tier, requerido)) return true;
    const activos = await TenantAddonsService.getActiveAddons(tenantId);
    return addonUnlocksPath(activos.map((a) => a.addonKey), PANTALLA);
}

/**
 * Anota los escalones y devuelve sólo los que no estaban anotados. INSERT
 * IGNORE contra la clave primaria hace de candado: dos corridas superpuestas
 * no avisan dos veces lo mismo.
 */
async function reclamarNuevos(tenantId: string, avisos: AvisoDeVencimiento[]): Promise<AvisoDeVencimiento[]> {
    const nuevos: AvisoDeVencimiento[] = [];
    for (const a of avisos) {
        const [r]: any = await pool.query(
            `INSERT IGNORE INTO ReservationExpiryNotices (tenant_id, reservation_id, expiry_date, threshold_days)
             VALUES (?, ?, ?, ?)`,
            [tenantId, a.reservationId, a.vence, a.escalon],
        );
        if (r?.affectedRows === 1) nuevos.push(a);
    }
    return nuevos;
}

export async function GET(request: NextRequest) {
    const startedAt = Date.now();
    try {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || cronSecret.length < 16) {
            console.error("CRON_SECRET not configured or too short");
            return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
        }
        if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        await initializeDatabase();

        const [filas]: any = await pool.query(
            `SELECT tenant_id, tier FROM Tenants
             WHERE subscription_status NOT IN ('CANCELED', 'EXPIRED')
             LIMIT 500`
        );

        const hoy = new Date();
        const enlace = `${urlPublica(request)}${PANTALLA}`;
        let evaluados = 0;
        let avisados = 0;
        const errores: string[] = [];

        for (const { tenant_id: tenantId, tier } of (filas || []) as { tenant_id: string; tier: string }[]) {
            if (isMockTenant(tenantId)) continue;
            try {
                if (!(await tieneLaPantalla(tenantId, tier))) continue;
                // Las reservas son de nivel TENANT (Microsoft.Capacity) y Lighthouse
                // delega por suscripción: con nuestra credencial, la lista sería la
                // de NUESTRO directorio y no la del cliente.
                if ((await getAccessModel(tenantId)) === "lighthouse") continue;

                const reservas = await getActiveReservations(await getAzureCredential(tenantId));
                evaluados++;

                const nuevos = await reclamarNuevos(tenantId, avisosDeVencimiento(reservas, hoy));
                if (nuevos.length === 0) continue;

                const { title, message } = textoDelAviso(nuevos);
                const severidad = gravedad(nuevos);
                await createNotification({
                    tenantId,
                    title,
                    message,
                    titleKey: "notif_reservation_expiry_title",
                    messageKey: "notif_reservation_expiry_msg",
                    params: { count: nuevos.length, days: nuevos[0].dias },
                    href: PANTALLA,
                    severity: severidad,
                    source: "reservation_expiry",
                });
                await notifyTenant(tenantId, {
                    title,
                    message,
                    severity: severidad === "critical" ? "error" : severidad,
                    link: enlace,
                });
                avisados++;
            } catch (e) {
                errores.push(`${tenantId}: ${errorMessage(e) || "error"}`);
            }
        }

        const respuesta = {
            success: true,
            evaluated: evaluados,
            notified: avisados,
            ...(errores.length ? { errors: errores.slice(0, 10) } : {}),
        };
        await recordCronRun({
            cronName: JOB,
            status: errores.length > 0 ? "warning" : "ok",
            durationMs: Date.now() - startedAt,
            summary: `evaluated=${evaluados} notified=${avisados}`,
            details: respuesta as unknown as Record<string, unknown>,
        });
        return NextResponse.json(respuesta);
    } catch (e: unknown) {
        await recordCronRun({
            cronName: JOB,
            status: "error",
            durationMs: Date.now() - startedAt,
            summary: e instanceof Error ? e.message : "cron failed",
            details: { error: e instanceof Error ? e.message : String(e) },
        });
        return serverError(e, { context: `GET /api/cron/${JOB}` });
    }
}
