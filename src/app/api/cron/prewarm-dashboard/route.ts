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
 * Auth de la cron (request entrante): Bearer <CRON_SECRET>, igual que /api/cron/sync.
 * Auth interna (fan-out a summary):   X-Cron-Auth: <CRON_SECRET>.
 *
 * RBAC: corre como identidad sintética cron@system con acceso al tenantId
 * que está pre-warmando. NO concede superadmin global.
 */
import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return runPrewarm(request);
}

export async function POST(request: NextRequest) {
  return runPrewarm(request);
}

async function runPrewarm(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || cronSecret.length < 16) {
      console.error("[cron-prewarm] CRON_SECRET not configured or too short");
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }

    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const [tenants] = await pool.query<any[]>(
      'SELECT tenant_id AS id, name FROM Tenants WHERE status = "active"'
    );

    const origin = request.nextUrl.origin;
    const headers: Record<string, string> = { "X-Cron-Auth": cronSecret };

    type Result = { tenantId: string; name?: string; ok: boolean; ms: number; error?: string };
    const results: Result[] = [];

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
        results.push({ tenantId: t.id, name: t.name, ok: false, ms, error: e?.message || String(e) });
        console.error(`[cron-prewarm] tenant=${t.id} threw:`, e?.message);
      }
    }

    const okCount = results.filter(r => r.ok).length;
    const totalMs = results.reduce((s, r) => s + r.ms, 0);

    return NextResponse.json({
      status: "Pre-warm completed",
      tenantsTotal: results.length,
      tenantsOk: okCount,
      tenantsFailed: results.length - okCount,
      totalMs,
      results,
    });
  } catch (e: any) {
    console.error("[cron-prewarm] fatal:", e);
    return NextResponse.json({ error: "Internal Server Error", details: e.message }, { status: 500 });
  }
}
