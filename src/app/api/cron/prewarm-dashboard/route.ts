/**
 * Cron pre-warmer del Dashboard General.
 *
 * Recorre todos los tenants activos y dispara `/api/dashboard/summary?subscriptionId=All`
 * con el header interno `X-Cron-Auth` para que el SWR cache (Redis) quede caliente.
 *
 * Resultado: el primer usuario que abra el dashboard nunca paga el cold-start
 * (~18s con audit + forecast en serie de redes a Azure). El cache productivo
 * tiene hard-TTL de 15 min y soft-TTL de 5 min — corriendo este cron cada 10 min
 * garantizamos hit permanente.
 *
 * Contrato HTTP (async_poll, mismo patrón que prewarm-compute/prewarm-databases):
 *  - `?status=1`: consulta el estado de la ejecución en curso/última en Redis.
 *  - Sin `status=1`: dispara el barrido en background (si no hay lock activo)
 *    y responde de inmediato con 202. El runner del Container App Job hace
 *    polling — el fetch inicial de disparo nunca espera el barrido completo.
 *
 * Por qué: antes esta ruta hacía el fan-out DENTRO del request y el Container
 * App Job runner (síncrono) esperaba la respuesta con un timeout de ~270s.
 * Con más de un puñado de tenants el barrido serial (2 endpoints ARM pesados
 * por tenant) supera ese presupuesto, el runner aborta y Azure marca la
 * ejecución "Failed" — aunque el barrido server-side siga corriendo y termine
 * bien poco después. Mismo síntoma y mismo fix que `sync`/`prewarm-daily`/
 * `prewarm-databases`/`prewarm-compute` (2026-07-30).
 *
 * Auth de la cron (request entrante): Bearer <CRON_SECRET> (o ?secret=, para
 * el runner async). Auth interna (fan-out a summary): X-Cron-Auth: <CRON_SECRET>.
 *
 * RBAC: corre como identidad sintética cron@system con acceso al tenantId
 * que está pre-warmando. NO concede superadmin global.
 */
import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { getInternalBaseUrl } from "@/lib/internalBaseUrl";
import { redis } from "@/lib/redis";
import { recordCronRun } from "@/lib/cronRunTracker";
import { errorMessage } from "@/lib/apiErrors";
import { escribirEstado, leerEstado, tomarLock, iniciarLatido, soltarLock } from "@/lib/cronAsyncJob";

export const dynamic = "force-dynamic";

const JOB = "prewarm-dashboard";

type PrewarmDashboardResult = { tenantId: string; name?: string; ok: boolean; ms: number; error?: string };

export type PrewarmDashboardStatus = {
    startedAt: number;
    finishedAt: number | null;
    done: boolean;
    ok: boolean | null;
    tenantsTotal?: number;
    tenantsOk?: number;
    tenantsFailed?: number;
    totalMs?: number;
    error?: string;
};


async function runPrewarmDashboardCore(): Promise<{ results: PrewarmDashboardResult[] }> {
    const [tenants] = await pool.query<any[]>(
        'SELECT tenant_id AS id, company_name AS name FROM Tenants WHERE status = "active"'
    );

    // Self-fetch server-side: loopback interno (NO la origin pública, que hace
    // NAT hairpin desde el contenedor y falla con "fetch failed").
    const origin = getInternalBaseUrl();
    const cronSecret = process.env.CRON_SECRET || "";
    const headers: Record<string, string> = { "X-Cron-Auth": cronSecret };

    const results: PrewarmDashboardResult[] = [];

    // Serialmente para no saturar Azure ARG (cada tenant pega 2 endpoints pesados).
    for (const t of tenants) {
        const start = Date.now();
        try {
            const url = `${origin}/api/dashboard/summary?tenantId=${encodeURIComponent(t.id)}&subscriptionId=All`;
            const res = await fetch(url, { headers, cache: "no-store" });
            const ms = Date.now() - start;
            if (res.ok) {
                results.push({ tenantId: t.id, name: t.name, ok: true, ms });
                console.log(`[cron-prewarm] tenant=${t.id} OK (${ms}ms)`);
            } else {
                const txt = await res.text().catch(() => "");
                results.push({ tenantId: t.id, name: t.name, ok: false, ms, error: `HTTP ${res.status}: ${txt.slice(0, 200)}` });
                console.warn(`[cron-prewarm] tenant=${t.id} HTTP ${res.status} in ${ms}ms`);
            }
        } catch (e: any) {
            const ms = Date.now() - start;
            const cause = e?.cause?.code || e?.cause?.message || "";
            const msg = `${e?.message || String(e)}${cause ? ` (${cause})` : ""}`;
            results.push({ tenantId: t.id, name: t.name, ok: false, ms, error: msg });
            console.error(`[cron-prewarm] tenant=${t.id} threw:`, msg);
        }
    }

    return { results };
}

function launchPrewarmCore(startedAt: number): void {
    runPrewarmDashboardCore()
        .then(async ({ results }) => {
            const finishedAt = Date.now();
            const okCount = results.filter((r) => r.ok).length;
            const totalMs = results.reduce((s, r) => s + r.ms, 0);
            const status: PrewarmDashboardStatus = {
                startedAt,
                finishedAt,
                done: true,
                ok: okCount === results.length,
                tenantsTotal: results.length,
                tenantsOk: okCount,
                tenantsFailed: results.length - okCount,
                totalMs,
            };
            await escribirEstado(JOB, status);
            if (redis?.status === "ready" || redis?.status === "connect") {
                await soltarLock(JOB);
            }
            await recordCronRun({
                cronName: "prewarm-dashboard",
                status: results.length - okCount > 0 ? "warning" : "ok",
                durationMs: finishedAt - startedAt,
                summary: `tenants=${okCount}/${results.length} OK`,
                details: { tenantsTotal: results.length, tenantsOk: okCount, tenantsFailed: results.length - okCount },
            });
        })
        .catch(async (e: any) => {
            console.error("[cron-prewarm] fatal:", e);
            const finishedAt = Date.now();
            await escribirEstado(JOB, { startedAt, finishedAt, done: true, ok: false, error: e?.message || String(e) });
            if (redis?.status === "ready" || redis?.status === "connect") {
                await soltarLock(JOB);
            }
            await recordCronRun({
                cronName: "prewarm-dashboard",
                status: "error",
                durationMs: finishedAt - startedAt,
                summary: e?.message || "prewarm-dashboard failed",
            });
        });
}

export async function GET(request: NextRequest) {
    return handlePrewarmDashboard(request);
}

export async function POST(request: NextRequest) {
    return handlePrewarmDashboard(request);
}

async function handlePrewarmDashboard(request: NextRequest) {
    try {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || cronSecret.length < 16) {
            console.error("[cron-prewarm] CRON_SECRET not configured or too short");
            return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
        }

        const authHeader = request.headers.get("authorization");
        const querySecret = request.nextUrl.searchParams.get("secret");
        const isAuthOk = authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret;
        if (!isAuthOk) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        // 1. Polling de status (?status=1)
        if (request.nextUrl.searchParams.get("status") === "1") {
            const status = await leerEstado(JOB);
            if (!status) {
                return NextResponse.json({ done: false, ok: null, status: "idle" });
            }
            return NextResponse.json(status);
        }

        // 2. Disparo con protección de Lock en Redis
        const lockAcquired = await tomarLock(JOB);

        if (!lockAcquired) {
            const current = await leerEstado(JOB);
            return NextResponse.json(
                { status: "already_running", message: "Hay una ejecución de prewarm-dashboard activa.", current },
                { status: 200 }
            );
        }

        const startedAt = Date.now();
        await escribirEstado(JOB, { startedAt, finishedAt: null, done: false, ok: null });

        // El latido arranca ANTES del trabajo: renueva el TTL corto del lock
        // mientras el proceso viva. Si el contenedor se cae con el barrido
        // adentro, nadie renueva y el lock expira en minutos -- el disparo
        // siguiente arranca limpio en vez de esperar media hora.
        iniciarLatido(JOB);
        launchPrewarmCore(startedAt);

        return NextResponse.json(
            {
                message: "Prewarm dashboard job started in background",
                statusPollUrl: "/api/cron/prewarm-dashboard?status=1",
                startedAt,
            },
            { status: 202 }
        );
    } catch (e) {
        console.error("[cron-prewarm] fatal:", e);
        return NextResponse.json({ error: "Internal Server Error", details: errorMessage(e) }, { status: 500 });
    }
}
