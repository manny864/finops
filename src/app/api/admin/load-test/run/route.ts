import { NextRequest, NextResponse } from "next/server";
import { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { runLoadTest, persistLoadTestRun, evaluateAndAlert, MAX_CONCURRENCY, MAX_DURATION_MS, type LoadTestTarget } from "@/lib/loadTester";
import { getLoadTestServicePrincipalToken } from "@/lib/loadTestAuth";
import { errorMessage } from '@/lib/apiErrors';

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
            } catch (e) {
                return NextResponse.json({ error: `No se pudo autenticar como Service Principal de load testing: ${errorMessage(e) || e}` }, { status: 500 });
            }
        }

        // Loopback, NO request.nextUrl.origin (dominio público): un self-fetch
        // del propio proceso contra su dominio público sale por Traefik/Internet
        // y vuelve a entrar por la misma IP del VPS — hairpin NAT que muchos
        // proveedores no soportan, y que produce fallos instantáneos (con
        // latencias de pocos ms, no de un round-trip real) leídos como 100% de
        // error. El healthcheck de Docker (docker-compose.yml) ya usa loopback
        // por esta misma razón; acá medimos el techo puro del proceso Node, no
        // el del proxy/red.
        const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;

        const result = await runLoadTest({
            origin,
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
