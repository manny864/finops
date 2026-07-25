import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase } from "@/modules/storage/db";
import { serverError } from "@/lib/apiErrors";
import { pendingReminderMilestone } from "@/lib/providerPolicy";
import {
    listTransitionsDueForPurge,
    listTransitionsInGrace,
    markReminderSent,
    notifyPurgeReminder,
    purgeArchivedProvider,
} from "@/services/providerLifecycleService";

/**
 * Cron: cierre del ciclo de vida del proveedor archivado tras un downgrade de
 * Enterprise con `provider = 'both'` (riesgo #7 del handoff AWS).
 *
 * Hace dos cosas, en este orden:
 *   1. Avisa (in-app + email) en T-30 y T-7 antes de la purga. Idempotente por
 *      las columnas notified_tNN_at: correr el cron dos veces el mismo dia no
 *      duplica el aviso.
 *   2. Purga los datos de los archivados cuya ventana de gracia ya vencio.
 *
 * El aviso va ANTES de la purga a proposito: si un dia la purga explota, el
 * cliente igual recibio sus recordatorios.
 *
 * Auth: mismo contrato que el resto de /api/cron — `Authorization: Bearer
 * $CRON_SECRET`. No es una ruta tenant-scoped y no lee tenantId del cliente,
 * asi que no aplica ningun guard de `requestAuth`.
 *
 * Frecuencia sugerida en el crontab del VPS: una vez por dia.
 */
export async function GET(request: NextRequest) {
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
        const now = new Date();

        let remindersSent = 0;
        for (const transition of await listTransitionsInGrace()) {
            const alreadySent: number[] = [];
            if (transition.notifiedT30At) alreadySent.push(30);
            if (transition.notifiedT7At) alreadySent.push(7);

            const milestone = pendingReminderMilestone(transition.purgeAt, now, alreadySent);
            if (milestone === null) continue;

            try {
                await notifyPurgeReminder(transition, milestone);
                await markReminderSent(transition.id, milestone);
                remindersSent++;
            } catch (e) {
                // Un tenant que falla no puede frenar al resto.
                console.error(
                    `[provider-archive-purge] reminder failed for tenant ${transition.tenantId}:`,
                    (e as Error)?.message || e
                );
            }
        }

        let purged = 0;
        const purgeDetails: Array<Record<string, unknown>> = [];
        for (const transition of await listTransitionsDueForPurge(now)) {
            try {
                const counts = await purgeArchivedProvider(transition);
                purged++;
                purgeDetails.push({
                    tenantId: transition.tenantId,
                    archivedProvider: transition.archivedProvider,
                    ...counts,
                });
            } catch (e) {
                console.error(
                    `[provider-archive-purge] purge failed for tenant ${transition.tenantId}:`,
                    (e as Error)?.message || e
                );
            }
        }

        return NextResponse.json({ success: true, remindersSent, purged, purgeDetails });
    } catch (error: any) {
        console.error("Provider Archive Purge Cron Error:", error);
        return serverError(error, { message: "Internal Server Error", status: 500 });
    }
}
