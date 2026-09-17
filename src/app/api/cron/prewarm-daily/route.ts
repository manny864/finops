/**
 * Job Diario de Pre-cálculo y Calentamiento de Caché en Redis (4:00 AM).
 *
 * Recorre todos los tenants activos y pre-computa todas las consultas pesadas de Azure:
 *  1. Dashboard General (/api/dashboard/summary)
 *  2. Auditoría KQL de 30+ reglas (/api/audit/full)
 *  3. Detección de Zombies & Financial Leaks (/api/cleanup/zombies)
 *  4. Whiteboard Ejecutivo & Proyecciones MTD (/api/overview/whiteboard)
 *  5. Facturación Histórica 13 meses (/api/billing/historical)
 *  6. Inventario de Recursos (/api/resources/inventory)
 *  7. Costos por Etiqueta (/api/resources/costs-by-tag)
 *  8. Madurez FinOps (/api/analytics/maturity)
 *  9. Scorecard FinOps (/api/analytics/scorecard)
 * 10. Progreso Histórico (/api/analytics/historical-progress)
 *
 * Contrato HTTP:
 *  - `?status=1`: Consulta el estado actual de la última ejecución en Redis (polling para Azure Container Apps).
 *  - Sin `status=1`: Dispara la ejecución en background (si no hay un lock activo) y responde de inmediato.
 */

import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { getInternalBaseUrl } from "@/lib/internalBaseUrl";
import { prewarmFetch } from "@/lib/prewarmFetch";
import { redis } from "@/lib/redis";
import { recordCronRun } from "@/lib/cronRunTracker";
import { errorMessage } from "@/lib/apiErrors";
import { escribirEstado, leerEstado, tomarLock, iniciarLatido, soltarLock } from "@/lib/cronAsyncJob";

export const dynamic = "force-dynamic";

const JOB = "prewarm-daily";

const PREWARM_ENDPOINTS = [
    { name: "dashboard_summary", path: (t: string) => `/api/dashboard/summary?tenantId=${encodeURIComponent(t)}&subscriptionId=All` },
    { name: "audit_full", path: (t: string) => `/api/audit/full?tenantId=${encodeURIComponent(t)}&subscriptionId=All` },
    { name: "zombies", path: (t: string) => `/api/cleanup/zombies?tenantId=${encodeURIComponent(t)}&subscriptionId=All` },
    { name: "whiteboard", path: (t: string) => `/api/overview/whiteboard?tenantId=${encodeURIComponent(t)}` },
    { name: "billing_historical", path: (t: string) => `/api/billing/historical?tenantId=${encodeURIComponent(t)}&months=13` },
    { name: "resources_inventory", path: (t: string) => `/api/resources/inventory?tenantId=${encodeURIComponent(t)}` },
    { name: "resources_costs_by_tag", path: (t: string) => `/api/resources/costs-by-tag?tenantId=${encodeURIComponent(t)}` },
    { name: "maturity", path: (t: string) => `/api/analytics/maturity?tenantId=${encodeURIComponent(t)}` },
    { name: "scorecard", path: (t: string) => `/api/analytics/scorecard?tenantId=${encodeURIComponent(t)}` },
    { name: "historical_progress", path: (t: string) => `/api/analytics/historical-progress?tenantId=${encodeURIComponent(t)}` },
    // days=30 es el unico rango que pide el panel de costo por categoria; si
    // algun dia ofrece otros, cada uno es una clave distinta y hay que sumarlo.
    { name: "cost_by_category", path: (t: string) => `/api/intelligence/cost-by-category?tenantId=${encodeURIComponent(t)}&days=30` },
];

export type PrewarmDailyStatus = {
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
    runPrewarmDailyCore(startedAt)
        .then(async (result) => {
            const finishedAt = Date.now();
            const status: PrewarmDailyStatus = {
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
                cronName: "prewarm-daily",
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
            console.error("[prewarm-daily] Fatal failure in background run:", e);
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
                cronName: "prewarm-daily",
                status: "error",
                durationMs: finishedAt - startedAt,
                summary: e?.message || "prewarm-daily failed",
            });
        });
}

async function runPrewarmDailyCore(startedAt: number) {
    const [tenants] = await pool.query<any[]>(
        'SELECT tenant_id AS id, company_name AS name FROM Tenants WHERE status = "active"'
    );

    const origin = getInternalBaseUrl();
    const cronSecret = process.env.CRON_SECRET || "";
    const headers: Record<string, string> = { "X-Cron-Auth": cronSecret };

    let endpointsSuccess = 0;
    let endpointsFailed = 0;
    let processedTenants = 0;
    const totalEndpoints = tenants.length * PREWARM_ENDPOINTS.length;

    for (const tenant of tenants) {
        processedTenants++;
        console.log(`[prewarm-daily] Pre-warming tenant ${processedTenants}/${tenants.length} (${tenant.id})...`);

        for (const ep of PREWARM_ENDPOINTS) {
            const startEp = Date.now();
            try {
                const url = `${origin}${ep.path(tenant.id)}`;
                const res = await prewarmFetch(url, { headers, cache: "no-store" });
                const ms = Date.now() - startEp;
                if (res.ok) {
                    endpointsSuccess++;
                    console.log(`[prewarm-daily] [OK] tenant=${tenant.id} ep=${ep.name} (${ms}ms)`);
                } else {
                    endpointsFailed++;
                    const txt = await res.text().catch(() => "");
                    console.warn(`[prewarm-daily] [WARN] tenant=${tenant.id} ep=${ep.name} HTTP ${res.status} (${ms}ms): ${txt.slice(0, 150)}`);
                }
            } catch (err: any) {
                endpointsFailed++;
                const ms = Date.now() - startEp;
                console.error(`[prewarm-daily] [ERR] tenant=${tenant.id} ep=${ep.name} (${ms}ms):`, errorMessage(err));
            }
        }

        // Pacing de 1s entre tenants para suavizar el consumo de APIs
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
    return handleRequest(request);
}

export async function POST(request: NextRequest) {
    return handleRequest(request);
}

async function handleRequest(request: NextRequest) {
    try {
        const cronSecret = process.env.CRON_SECRET;
        if (!cronSecret || cronSecret.length < 16) {
            return NextResponse.json({ error: "Service unavailable: CRON_SECRET missing or invalid" }, { status: 503 });
        }

        const isStatusCheck = request.nextUrl.searchParams.get("status") === "1";
        if (isStatusCheck) {
            const current = await leerEstado(JOB);
            return NextResponse.json(current || { done: false, ok: null, message: "No execution status available" });
        }

        // Validar autenticación
        const authHeader = request.headers.get("authorization");
        const querySecret = request.nextUrl.searchParams.get("secret");
        const isAuthed = authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret;

        if (!isAuthed) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        // Verificar o adquirir lock en Redis
        let lockAcquired = true;
        if (redis?.status === "ready" || redis?.status === "connect") {
            const acquired = await tomarLock(JOB);
            if (!acquired) {
                lockAcquired = false;
            }
        }

        if (!lockAcquired) {
            const current = await leerEstado(JOB);
            return NextResponse.json({
                message: "Prewarm daily job already in progress",
                status: current || { done: false, ok: null },
            }, { status: 202 });
        }

        const startedAt = Date.now();
        await escribirEstado(JOB, {
            startedAt,
            finishedAt: null,
            done: false,
            ok: null,
        });

        // Lanzar ejecución asíncrona sin bloquear la respuesta HTTP
        // El latido arranca ANTES del trabajo: renueva el TTL corto del lock
        // mientras el proceso viva. Si el contenedor se cae con el barrido
        // adentro, nadie renueva y el lock expira en minutos -- el disparo
        // siguiente arranca limpio en vez de esperar media hora.
        iniciarLatido(JOB);
        launchPrewarmCore(startedAt);

        return NextResponse.json({
            message: "Prewarm daily job started in background",
            startedAt,
            statusPollUrl: `${request.nextUrl.pathname}?status=1`,
        }, { status: 202 });

    } catch (e) {
        console.error("[prewarm-daily] Request handler error:", e);
        return NextResponse.json({ error: "Internal Server Error", details: errorMessage(e) }, { status: 500 });
    }
}
