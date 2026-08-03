import { NextRequest, NextResponse } from "next/server";
import { executeDueSchedules } from "@/services/powerScheduleService";
import { recordCronRun } from "@/lib/cronRunTracker";

/**
 * Cron de ejecución de Power Schedules (apagado programado de VMs).
 *
 * Se invoca desde el crontab del VPS (o cualquier scheduler externo) cada
 * ~2 min (antes 10 min — reducido para bajar la latencia máxima percibida),
 * mismo patrón que /api/cron/sync y /api/cron/prewarm-dashboard.
 * Auth: Authorization: Bearer CRON_SECRET.
 *
 * Ejemplo crontab (ver README.md, sección Cron Jobs, para el comando completo):
 * cada 10 minutos -> curl con header Authorization Bearer $CRON_SECRET hacia
 * /api/cron/power-schedules.
 */
export async function GET(request: NextRequest) {
    return runPowerSchedules(request);
}

export async function POST(request: NextRequest) {
    return runPowerSchedules(request);
}

async function runPowerSchedules(request: NextRequest) {
    const startedAt = Date.now();
    try {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || cronSecret.length < 16) {
            console.error("CRON_SECRET not configured or too short");
            return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
        }
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${cronSecret}`) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        // Ventana de 8 min: > 4x la cadencia del cron (2 min) para tolerar
        // ticks perdidos/downtime puntual sin dejar de ejecutar el horario.
        const result = await executeDueSchedules(8);

        console.log(
            `[cron-power-schedules] evaluated=${result.evaluated} executed=${result.executed} skipped=${result.skipped} failed=${result.failed}`
        );
        await recordCronRun({
            cronName: "power-schedules",
            status: result.failed > 0 ? "warning" : "ok",
            durationMs: Date.now() - startedAt,
            summary: `evaluated=${result.evaluated} executed=${result.executed} failed=${result.failed}`,
            details: result as unknown as Record<string, unknown>,
        });

        return NextResponse.json({ status: "Power schedules processed", ...result });
    } catch (e: unknown) {
        console.error("[cron-power-schedules] Error:", e);
        await recordCronRun({
            cronName: "power-schedules",
            status: "error",
            durationMs: Date.now() - startedAt,
            summary: e instanceof Error ? e.message : "Internal server error",
            details: { error: e instanceof Error ? e.message : String(e) },
        });
        const message = e instanceof Error ? e.message : "Internal server error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
