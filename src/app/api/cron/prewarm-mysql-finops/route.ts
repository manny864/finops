import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { getInternalBaseUrl } from "@/lib/internalBaseUrl";
import { prewarmFetch } from "@/lib/prewarmFetch";
import { errorMessage } from "@/lib/apiErrors";
import { escribirEstado, leerEstado, tomarLock, iniciarLatido, soltarLock } from "@/lib/cronAsyncJob";

export const dynamic = "force-dynamic";

const JOB = "prewarm-mysql-finops";

export type PrewarmMysqlStatus = {
  startedAt: number;
  finishedAt: number | null;
  done: boolean;
  ok: boolean | null;
  tenantsTotal?: number;
  tenantsOk?: number;
  tenantsFailed?: number;
  error?: string;
};

/**
 * Fire-and-forget: NO se espera acá.
 *
 * El barrido pide las métricas de MySQL de cada tenant en serie, y supera los
 * ~240s que tolera el ingress de Container Apps. Devolvía `504 stream timeout`
 * y Azure marcaba la ejecución fallida --14 en 24 h-- aunque el prewarm
 * terminara bien. Mismo techo de plataforma y misma solución que `sync`,
 * `prewarm-dashboard` y `anomaly-detection`.
 */
function launchPrewarm(startedAt: number, cronSecret: string): void {
  runPrewarmSweep(cronSecret)
    .then(async (results) => {
      const okCount = results.filter((r) => r.ok).length;
      await escribirEstado(JOB, {
        startedAt,
        finishedAt: Date.now(),
        done: true,
        ok: okCount === results.length,
        tenantsTotal: results.length,
        tenantsOk: okCount,
        tenantsFailed: results.length - okCount,
      });
    })
    .catch(async (e) => {
      await escribirEstado(JOB, {
        startedAt, finishedAt: Date.now(), done: true, ok: false,
        error: errorMessage(e) || String(e),
      });
    })
    // Soltar el lock ACÁ es lo que corta el latido: mientras el trabajo vive, el
    // latido renueva el TTL corto; si el proceso muere, nadie renueva y el lock
    // expira en minutos en vez de bloquear el cron hasta agotar un TTL largo.
    .finally(() => soltarLock(JOB));
}

export async function GET(request: NextRequest) {
  return runPrewarmMysqlFinops(request);
}

export async function POST(request: NextRequest) {
  return runPrewarmMysqlFinops(request);
}

async function runPrewarmMysqlFinops(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || cronSecret.length < 16) {
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    // Polling de estado: sin este contrato el runner no puede esperar un
    // barrido largo sin que el ingress lo corte a los 240s.
    if (request.nextUrl.searchParams.get("status") === "1") {
      const status = await leerEstado(JOB);
      return NextResponse.json(status ?? { done: false, ok: null, status: "idle" });
    }

    // Lock: el job corre cada 20 minutos y el barrido puede pasarse. Sin esto,
    // dos barridos concurrentes duplicarían las consultas de métricas.
    if (!(await tomarLock(JOB))) {
      return NextResponse.json(
        { status: "already_running", message: "Hay un prewarm de MySQL activo.", current: await leerEstado(JOB) },
        { status: 200 }
      );
    }

    await escribirEstado(JOB, { startedAt, finishedAt: null, done: false, ok: null });
    iniciarLatido(JOB);
    launchPrewarm(startedAt, cronSecret);

    return NextResponse.json(
      {
        message: "MySQL FinOps prewarm started in background",
        statusPollUrl: "/api/cron/prewarm-mysql-finops?status=1",
        startedAt,
      },
      { status: 202 }
    );
  } catch (error: unknown) {
    await soltarLock(JOB);
    return NextResponse.json(
      { error: "Internal Server Error", details: errorMessage(error) },
      { status: 500 }
    );
  }
}

/** El barrido real. Antes vivía inline en el handler y por eso lo mataba el ingress. */
async function runPrewarmSweep(cronSecret: string) {
  const [tenants] = await pool.query<any[]>(
    'SELECT tenant_id AS id FROM Tenants WHERE status = "active"'
  );

  const origin = getInternalBaseUrl();
  const headers: Record<string, string> = { "X-Cron-Auth": cronSecret };
  const results: Array<{ tenantId: string; ok: boolean; ms: number; error?: string }> = [];

  for (const tenant of tenants) {
    const start = Date.now();
    try {
      const url = `${origin}/api/intelligence/databases/mysql-metrics?tenantId=${encodeURIComponent(tenant.id)}&bust=1`;
      const res = await prewarmFetch(url, { headers, cache: "no-store" });
      const ms = Date.now() - start;
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        results.push({ tenantId: tenant.id, ok: false, ms, error: `HTTP ${res.status}: ${detail.slice(0, 200)}` });
        continue;
      }
      results.push({ tenantId: tenant.id, ok: true, ms });
    } catch (error: unknown) {
      results.push({ tenantId: tenant.id, ok: false, ms: Date.now() - start, error: errorMessage(error) });
    }
  }
  return results;
}
