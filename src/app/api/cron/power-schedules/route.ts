import { NextRequest, NextResponse } from "next/server";
import { executeDueSchedules } from "@/services/powerScheduleService";

/**
 * Cron de ejecución de Power Schedules (apagado programado de VMs).
 *
 * Se invoca desde el crontab del VPS (o cualquier scheduler externo) cada
 * ~10 min, mismo patrón que /api/cron/sync y /api/cron/prewarm-dashboard.
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

        const result = await executeDueSchedules(15);

        console.log(
            `[cron-power-schedules] evaluated=${result.evaluated} executed=${result.executed} skipped=${result.skipped} failed=${result.failed}`
        );

        return NextResponse.json({ status: "Power schedules processed", ...result });
    } catch (e: unknown) {
        console.error("[cron-power-schedules] Error:", e);
        const message = e instanceof Error ? e.message : "Internal server error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
