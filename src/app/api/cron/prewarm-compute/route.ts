/**
 * Job Periódico de Pre-cálculo y Calentamiento de Caché de Cómputo (VMs, WebApps, Functions, VMSS, ARO).
 *
 * Contrato HTTP (async_poll):
 *  - `?status=1`: Consulta el estado actual de la ejecución en Redis (polling para Container Apps Job).
 *  - Sin `status=1`: Dispara la ejecución en background (si no hay un lock activo) y responde de inmediato con 202 Accepted.
 */

import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { getInternalBaseUrl } from "@/lib/internalBaseUrl";
import { prewarmFetch } from "@/lib/prewarmFetch";
import { redis } from "@/lib/redis";
import { recordCronRun } from "@/lib/cronRunTracker";
import { errorMessage } from "@/lib/apiErrors";
import { escribirEstado, leerEstado, tomarLock, iniciarLatido, soltarLock } from "@/lib/cronAsyncJob";
import type { ComputeFamily } from "@/lib/computeWorkloadTypes";

export const dynamic = "force-dynamic";

const JOB = "prewarm-compute";

const FAMILIES: ComputeFamily[] = ["webapps", "functions", "vms", "vmss", "aro"];

export type PrewarmComputeStatus = {
    startedAt: number;
    finishedAt: number | null;
    done: boolean;
    ok: boolean | null;
    processedTenants?: number;
    tenantsTotal?: number;
    workloadsTotal?: number;
    workloadsSuccess?: number;
    workloadsFailed?: number;
    error?: string;
};


function launchPrewarmCore(startedAt: number): void {
    runPrewarmComputeCore(startedAt)
        .then(async (result) => {
            const finishedAt = Date.now();
            const status: PrewarmComputeStatus = {
                startedAt,
                finishedAt,
                done: true,
                ok: result.workloadsFailed === 0,
                ...result,
            };
            await escribirEstado(JOB, status);
            if (redis?.status === "ready" || redis?.status === "connect") {
                await soltarLock(JOB);
            }
            await recordCronRun({
                cronName: "prewarm-compute",
                status: result.workloadsFailed > 0 ? "warning" : "ok",
                durationMs: finishedAt - startedAt,
                summary: `tenants=${result.processedTenants}/${result.tenantsTotal} workloadsOk=${result.workloadsSuccess}/${result.workloadsTotal}`,
                details: {
                    processedTenants: result.processedTenants,
                    tenantsTotal: result.tenantsTotal,
                    workloadsSuccess: result.workloadsSuccess,
                    workloadsFailed: result.workloadsFailed,
                },
            });
        })
        .catch(async (e: any) => {
            console.error("[prewarm-compute] Fatal failure in background run:", e);
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
                cronName: "prewarm-compute",
                status: "error",
                durationMs: finishedAt - startedAt,
                summary: e?.message || "prewarm-compute failed",
            });
        });
}

async function runPrewarmComputeCore(startedAt: number) {
    const [tenants] = await pool.query<any[]>(
        'SELECT tenant_id AS id, company_name AS name FROM Tenants WHERE status = "active"'
    );

    const origin = getInternalBaseUrl();
    const cronSecret = process.env.CRON_SECRET || "";
    const headers: Record<string, string> = { "X-Cron-Auth": cronSecret };

    let workloadsSuccess = 0;
    let workloadsFailed = 0;
    let processedTenants = 0;
    const totalWorkloads = tenants.length * FAMILIES.length;

    for (const tenant of tenants) {
        processedTenants++;
        console.log(`[prewarm-compute] Pre-warming compute workloads for tenant ${processedTenants}/${tenants.length} (${tenant.id})...`);

        for (const family of FAMILIES) {
            const startF = Date.now();
            try {
                const url = `${origin}/api/intelligence/compute/workloads?tenantId=${encodeURIComponent(tenant.id)}&family=${family}`;
                const res = await prewarmFetch(url, { headers, cache: "no-store" });
                const ms = Date.now() - startF;
                if (res.ok) {
                    workloadsSuccess++;
                    console.log(`[prewarm-compute] [OK] tenant=${tenant.id} family=${family} (${ms}ms)`);
                } else {
                    workloadsFailed++;
                    const txt = await res.text().catch(() => "");
                    console.warn(`[prewarm-compute] [WARN] tenant=${tenant.id} family=${family} HTTP ${res.status} (${ms}ms): ${txt.slice(0, 150)}`);
                }
            } catch (err: any) {
                workloadsFailed++;
                const ms = Date.now() - startF;
                console.error(`[prewarm-compute] [ERR] tenant=${tenant.id} family=${family} (${ms}ms):`, errorMessage(err));
            }
            await new Promise((r) => setTimeout(r, 200));
        }

        await new Promise((r) => setTimeout(r, 1000));
    }

    return {
        processedTenants,
        tenantsTotal: tenants.length,
        workloadsTotal: totalWorkloads,
        workloadsSuccess,
        workloadsFailed,
    };
}

export async function GET(request: NextRequest) {
    return handlePrewarmCompute(request);
}

export async function POST(request: NextRequest) {
    return handlePrewarmCompute(request);
}

async function handlePrewarmCompute(request: NextRequest) {
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
                    message: "Hay una ejecución de prewarm-compute activa.",
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

        // El latido arranca ANTES del trabajo: renueva el TTL corto del lock
        // mientras el proceso viva. Si el contenedor se cae con el barrido
        // adentro, nadie renueva y el lock expira en minutos -- el disparo
        // siguiente arranca limpio en vez de esperar media hora.
        iniciarLatido(JOB);
        launchPrewarmCore(startedAt);

        return NextResponse.json(
            {
                message: "Prewarm compute job started in background",
                statusPollUrl: "/api/cron/prewarm-compute?status=1",
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
