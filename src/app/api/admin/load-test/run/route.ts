import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { runLoadTest, persistLoadTestRun, evaluateAndAlert, MAX_CONCURRENCY, MAX_DURATION_MS, type LoadTestTarget } from "@/lib/loadTester";

// SUPERADMIN-only: genera carga real contra el propio servidor para evaluar
// el impacto de alta concurrencia (ver src/lib/loadTester.ts). Los límites
// duros (MAX_CONCURRENCY/MAX_DURATION_MS) están en el runner, no acá, para
// que ningún caller pueda saltearlos.
export async function POST(request: NextRequest) {
    try {
        await initializeDatabase();
        const identity = await requireSuperAdmin(request);

        const body = await request.json().catch(() => ({}));
        const target: LoadTestTarget = body.target === 'status' ? 'status' : 'health';
        const concurrency = Number(body.concurrency) || 10;
        const durationSeconds = Number(body.durationSeconds) || 5;

        if (concurrency < 1 || concurrency > MAX_CONCURRENCY) {
            return NextResponse.json({ error: `Concurrencia debe estar entre 1 y ${MAX_CONCURRENCY}.` }, { status: 400 });
        }
        if (durationSeconds < 1 || durationSeconds * 1000 > MAX_DURATION_MS) {
            return NextResponse.json({ error: `Duración debe estar entre 1 y ${MAX_DURATION_MS / 1000} segundos.` }, { status: 400 });
        }

        const result = await runLoadTest({
            origin: request.nextUrl.origin,
            target,
            concurrency,
            durationMs: durationSeconds * 1000,
        });

        const runId = await persistLoadTestRun(result, identity.email);
        const alert = await evaluateAndAlert(result, runId);

        return NextResponse.json({ success: true, runId, result, alert });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[admin/load-test/run] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
