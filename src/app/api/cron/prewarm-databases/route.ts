/**
 * Job Periódico de Pre-cálculo y Calentamiento de Caché de Bases de Datos.
 *
 * Recorre todos los tenants activos y pre-computa todas las consultas de bases de datos:
 *  1. cosmos-diagnostics
 *  2. cosmos-metrics
 *  3. sql-diagnostics
 *  4. sql-metrics
 *  5. postgres-diagnostics
 *  6. mysql-diagnostics
 *  7. mongo-diagnostics
 *  8. mongo-metrics
 *  9. redis-diagnostics
 * 10. redis-metrics
 * 11. mysql-metrics
 * 12. postgres-metrics
 *
 * Contrato HTTP (async_poll):
 *  - `?status=1`: Consulta el estado actual de la ejecución en Redis (polling para Container Apps Job).
 *  - Sin `status=1`: Dispara la ejecución en background (si no hay un lock activo) y responde de inmediato con 202 Accepted.
 */

import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { getInternalBaseUrl } from "@/lib/internalBaseUrl";
import { redis } from "@/lib/redis";
import { recordCronRun } from "@/lib/cronRunTracker";
import { errorMessage } from "@/lib/apiErrors";
import { escribirEstado, leerEstado, tomarLock, iniciarLatido, soltarLock } from "@/lib/cronAsyncJob";

export const dynamic = "force-dynamic";

const JOB = "prewarm-databases";

const DATABASE_ENDPOINTS = [
    "cosmos-diagnostics",
    "cosmos-metrics",
    "sql-diagnostics",
    "sql-metrics",
    "postgres-diagnostics",
    "mysql-diagnostics",
    "mongo-diagnostics",
    "mongo-metrics",
    "redis-diagnostics",
    "redis-metrics",
    "mysql-metrics",
    "postgres-metrics",
] as const;

export type PrewarmDatabasesStatus = {
    startedAt: number;
    finishedAt: number | null;
    done: boolean;
    ok: boolean | null;
    processedTenants?: number;
    tenantsTotal?: number;
    endpointsTotal?: number;
    endpointsSuccess?: number;
    endpointsFailed?: number;
    error?: string;
};


function launchPrewarmCore(startedAt: number): void {
    runPrewarmDatabasesCore(startedAt)
        .then(async (result) => {
            const finishedAt = Date.now();
            const status: PrewarmDatabasesStatus = {
                startedAt,
                finishedAt,
                done: true,
                ok: result.endpointsFailed === 0,
                ...result,
            };
            await escribirEstado(JOB, status);
            if (redis?.status === "ready" || redis?.status === "connect") {
                await soltarLock(JOB);
            }
            await recordCronRun({
                cronName: "prewarm-databases",
                status: result.endpointsFailed > 0 ? "warning" : "ok",
                durationMs: finishedAt - startedAt,
                summary: `tenants=${result.processedTenants}/${result.tenantsTotal} endpointsOk=${result.endpointsSuccess}/${result.endpointsTotal}`,
                details: {
                    processedTenants: result.processedTenants,
                    tenantsTotal: result.tenantsTotal,
                    endpointsSuccess: result.endpointsSuccess,
                    endpointsFailed: result.endpointsFailed,
                },
            });
        })
        .catch(async (e: any) => {
            console.error("[prewarm-databases] Fatal failure in background run:", e);
            const finishedAt = Date.now();
            await escribirEstado(JOB, {
                startedAt,
                finishedAt,
                done: true,
                ok: false,
                error: e?.message || String(e),
            });
            if (redis?.status === "ready" || redis?.status === "connect") {
                await soltarLock(JOB);
            }
            await recordCronRun({
                cronName: "prewarm-databases",
                status: "error",
                durationMs: finishedAt - startedAt,
                summary: e?.message || "prewarm-databases failed",
            });
        });
}

async function runPrewarmDatabasesCore(startedAt: number) {
    const [tenants] = await pool.query<any[]>(
        'SELECT tenant_id AS id, company_name AS name FROM Tenants WHERE status = "active"'
    );

    const origin = getInternalBaseUrl();
    const cronSecret = process.env.CRON_SECRET || "";
    const headers: Record<string, string> = { "X-Cron-Auth": cronSecret };

    let endpointsSuccess = 0;
    let endpointsFailed = 0;
    let processedTenants = 0;
    const totalEndpoints = tenants.length * DATABASE_ENDPOINTS.length;

    for (const tenant of tenants) {
        processedTenants++;
        console.log(`[prewarm-databases] Pre-warming databases for tenant ${processedTenants}/${tenants.length} (${tenant.id})...`);

        for (const ep of DATABASE_ENDPOINTS) {
            const startEp = Date.now();
            try {
                const url = `${origin}/api/intelligence/databases/${ep}?tenantId=${encodeURIComponent(tenant.id)}`;
                const res = await fetch(url, { headers, cache: "no-store" });
                const ms = Date.now() - startEp;
                if (res.ok) {
                    endpointsSuccess++;
                    console.log(`[prewarm-databases] [OK] tenant=${tenant.id} ep=${ep} (${ms}ms)`);
                } else {
                    endpointsFailed++;
                    const txt = await res.text().catch(() => "");
                    console.warn(`[prewarm-databases] [WARN] tenant=${tenant.id} ep=${ep} HTTP ${res.status} (${ms}ms): ${txt.slice(0, 150)}`);
                }
            } catch (err: any) {
                endpointsFailed++;
                const ms = Date.now() - startEp;
                console.error(`[prewarm-databases] [ERR] tenant=${tenant.id} ep=${ep} (${ms}ms):`, errorMessage(err));
            }
            // Pacing de 200ms entre endpoints para no saturar Rate Limits de Azure
            await new Promise((r) => setTimeout(r, 200));
        }

        // Pacing de 1s entre tenants
        await new Promise((r) => setTimeout(r, 1000));
    }

    return {
        processedTenants,
        tenantsTotal: tenants.length,
        endpointsTotal: totalEndpoints,
        endpointsSuccess,
        endpointsFailed,
    };
}

export async function GET(request: NextRequest) {
    return handlePrewarmDatabases(request);
}

export async function POST(request: NextRequest) {
    return handlePrewarmDatabases(request);
}

async function handlePrewarmDatabases(request: NextRequest) {
    try {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || cronSecret.length < 16) {
            return NextResponse.json({ error: "CRON_SECRET not configured or too short" }, { status: 503 });
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
                {
                    status: "already_running",
                    message: "Hay una ejecución de prewarm-databases activa.",
                    current,
                },
                { status: 200 }
            );
        }

        const startedAt = Date.now();
        await escribirEstado(JOB, {
            startedAt,
            finishedAt: null,
            done: false,
            ok: null,
        });

        // Lanzar en background de forma asíncrona
        // El latido arranca ANTES del trabajo: renueva el TTL corto del lock
        // mientras el proceso viva. Si el contenedor se cae con el barrido
        // adentro, nadie renueva y el lock expira en minutos -- el disparo
        // siguiente arranca limpio en vez de esperar media hora.
        iniciarLatido(JOB);
        launchPrewarmCore(startedAt);

        return NextResponse.json(
            {
                message: "Prewarm databases job started in background",
                statusPollUrl: "/api/cron/prewarm-databases?status=1",
                startedAt,
            },
            { status: 202 }
        );
    } catch (error: unknown) {
        return NextResponse.json(
            { error: "Internal Server Error", details: errorMessage(error) },
            { status: 500 }
        );
    }
}
