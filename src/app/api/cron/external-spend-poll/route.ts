import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase } from "@/modules/storage/db";
import { serverError } from "@/lib/apiErrors";
import { recordCronRun } from "@/lib/cronRunTracker";
import { urlPublica } from "@/lib/urlPublica";
import { processPendingDocuments, purgeExpiredFiles } from "@/services/externalSpend.service";
import { sendCommitmentRenewalAlerts } from "@/services/commitmentRenewalAlerts.service";

/**
 * Gasto externo (Fase 4 de la propuesta de IA), cada 5 minutos:
 *
 * 1. Avanza los documentos que la subida dejó en análisis: consulta la
 *    operación de Document Intelligence, mapea, valida y los deja para
 *    revisión.
 * 2. Retención: borra los originales ya revisados de más de 365 días.
 * 3. Avisa las fechas límite de preaviso de los compromisos (90, 60 y 30
 *    días), una vez por escalón.
 *
 * ponytail: los tres en el mismo job para no sumar otro en Terraform; los
 * pasos 2 y 3 son una consulta cuando no hay nada que hacer.
 */
const JOB = "external-spend-poll";

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

        const documents = await processPendingDocuments();
        const purged = await purgeExpiredFiles();
        const renewals = await sendCommitmentRenewalAlerts(urlPublica(request));

        const errors = [...documents.errors, ...renewals.errors];
        const response = {
            success: true,
            processed: documents.processed,
            purged,
            evaluated: renewals.evaluated,
            notified: renewals.notified,
            ...(errors.length ? { errors: errors.slice(0, 10) } : {}),
        };
        await recordCronRun({
            cronName: JOB,
            status: errors.length > 0 ? "warning" : "ok",
            durationMs: Date.now() - startedAt,
            summary: `processed=${documents.processed} purged=${purged} notified=${renewals.notified}`,
            details: response as unknown as Record<string, unknown>,
        });
        return NextResponse.json(response);
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

export const POST = GET;
