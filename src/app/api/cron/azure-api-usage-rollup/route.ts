import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase } from "@/modules/storage/db";
import { errorMessage, serverError } from "@/lib/apiErrors";
import { recordCronRun } from "@/lib/cronRunTracker";
import { volcarUsoApiAzureAMysql } from "@/lib/azureApiMetrics";

/**
 * Persiste en MySQL los contadores de llamadas a las APIs de Azure.
 *
 * La telemetría se acumula en Redis, y Redis acá no es un almacén: el cache de
 * producción no tiene persistencia (`rdbEnabled=false`, `aofEnabled=false`), su
 * política es `AllKeysLRU` --puede desalojar claves vigentes si se llena-- y el
 * TTL es de 8 días. Para diagnosticar un incidente del día alcanza; para
 * comparar un mes contra otro, o para mirar la evidencia DESPUÉS de que pasó
 * algo, no.
 *
 * Se vuelcan 12 horas hacia atrás en cada corrida, no una: si el cron se saltea
 * una ejecución --deploy, reinicio, el propio job fallando-- la siguiente
 * recupera lo que quedó sin volcar en vez de dejar un agujero permanente. Como
 * los contadores son acumulados por hora, repisarlos es inofensivo.
 *
 * Agendar cada hora con `Authorization: Bearer $CRON_SECRET`.
 */
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
        const { filas } = await volcarUsoApiAzureAMysql(12);

        await recordCronRun({
            cronName: "azure-api-usage-rollup",
            status: "ok",
            durationMs: Date.now() - startedAt,
            summary: `${filas} fila(s) de telemetría persistidas`,
        });

        return NextResponse.json({ success: true, filas });
    } catch (error) {
        await recordCronRun({
            cronName: "azure-api-usage-rollup",
            status: "error",
            durationMs: Date.now() - startedAt,
            summary: errorMessage(error) || "error",
        });
        return serverError(error, {
            context: "cron/azure-api-usage-rollup",
            message: "Fallo el volcado de telemetría de APIs de Azure.",
        });
    }
}
