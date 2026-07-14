import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { runLoadTest, persistLoadTestRun, evaluateAndAlert, MAX_CONCURRENCY, MAX_DURATION_MS, type LoadTestTarget } from "@/lib/loadTester";
import { getLoadTestServicePrincipalToken } from "@/lib/loadTestAuth";

// SUPERADMIN-only: genera carga real contra el propio servidor para evaluar
// el impacto de alta concurrencia (ver src/lib/loadTester.ts). Los límites
// duros (MAX_CONCURRENCY/MAX_DURATION_MS) están en el runner, no acá, para
// que ningún caller pueda saltearlos.
export async function POST(request: NextRequest) {
    try {
        await initializeDatabase();
        const identity = await requireSuperAdmin(request);

        const body = await request.json().catch(() => ({}));
        const target: LoadTestTarget = body.target === 'status' ? 'status' : body.target === 'probe' ? 'probe' : 'health';
        const concurrency = Number(body.concurrency) || 10;
        const durationSeconds = Number(body.durationSeconds) || 5;

        if (concurrency < 1 || concurrency > MAX_CONCURRENCY) {
            return NextResponse.json({ error: `Concurrencia debe estar entre 1 y ${MAX_CONCURRENCY}.` }, { status: 400 });
        }
        if (durationSeconds < 1 || durationSeconds * 1000 > MAX_DURATION_MS) {
            return NextResponse.json({ error: `Duración debe estar entre 1 y ${MAX_DURATION_MS / 1000} segundos.` }, { status: 400 });
        }

        // target='probe' es el mismo endpoint autenticado que usa el flujo
        // externo con JMeter/k6 (ver docs/loadtest.md) — acá el propio backend
        // hace el client_credentials en nombre del operador, así no hace falta
        // correr nada a mano para probar esa ruta desde la página.
        let authToken: string | undefined;
        if (target === 'probe') {
            try {
                authToken = await getLoadTestServicePrincipalToken();
            } catch (e: any) {
                return NextResponse.json({ error: `No se pudo autenticar como Service Principal de load testing: ${e?.message || e}` }, { status: 500 });
            }
        }

        const result = await runLoadTest({
            origin: request.nextUrl.origin,
            target,
            concurrency,
            durationMs: durationSeconds * 1000,
            authToken,
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
