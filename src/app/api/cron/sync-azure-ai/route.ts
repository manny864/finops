import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { errorMessage } from '@/lib/apiErrors';
import { mapWithConcurrency } from "@/modules/collectors/azure/billing/billingHelpers";

const CRON_SECRET = process.env.CRON_SECRET || "unsafe-default";

// Cuántos tenants se sincronizan a la vez. Cada uno es un fetch HTTP a la PROPIA web (`/api/intelligence/azure-ai`,
// una ruta de 1.5k líneas que llama a varias APIs de Azure), y esa web tiene 1 vCPU: antes se lanzaban todos
// juntos con `Promise.allSettled` (hasta 100 tenants Enterprise = 100 requests pesadas simultáneas). Con
// 5 o menos tenants, que es lo de hoy, el comportamiento es el mismo.
const MAX_TENANTS_EN_PARALELO = 5;

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization") || "";
    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !timingSafeCompare(token, CRON_SECRET)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Cron route: authenticated via CRON_SECRET Bearer above (not a tenant JWT).
    // tenantId here only narrows which Enterprise tenants to sync and is validated
    // against the DB; it never grants tenant-scoped access on its own.
    // eslint-disable-next-line local/no-unauth-tenant-id
    const tenantIdParam = request.nextUrl.searchParams.get("tenantId");
    let tenants: any[] = [];
    if (tenantIdParam) {
      const [rows]: any = await pool.query(
        "SELECT id FROM Tenants WHERE (id = ? OR tenant_id = ?) AND tier = 'Enterprise' LIMIT 1",
        [tenantIdParam, tenantIdParam]
      );
      tenants = rows || [];
    } else {
      const [rows]: any = await pool.query(
        "SELECT id FROM Tenants WHERE tier = 'Enterprise' LIMIT 100"
      );
      tenants = rows || [];
    }

    if (!tenants || tenants.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No Enterprise tenants found",
        count: 0,
        timestamp: new Date().toISOString(),
      });
    }

    // El mapeador no lanza (cada tenant atrapa su propio error y devuelve `{ error }`), así que un tenant
    // que falla no frena a los demás, igual que con `allSettled`.
    const results = await mapWithConcurrency(
      tenants,
      MAX_TENANTS_EN_PARALELO,
      async (tenant: any) => {
        try {
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
          const res = await fetch(`${baseUrl}/api/intelligence/azure-ai?tenantId=${tenant.id}`, {
            headers: { "X-Cron-Auth": CRON_SECRET },
            cache: "no-store",
          });

          if (!res.ok) {
            console.warn(`Azure AI sync failed for tenant ${tenant.id}: ${res.status}`);
            return { tenantId: tenant.id, cached: false, error: res.statusText };
          }

          const data = await res.json();
          return { tenantId: tenant.id, cached: !data.mock, capCount: data.capabilities?.length || 0 };
        } catch (err) {
          console.error(`Azure AI sync error for tenant ${tenant.id}:`, err);
          return { tenantId: tenant.id, cached: false, error: String(err) };
        }
      }
    );

    const successful = results.filter((r) => r.cached).length;

    return NextResponse.json({
      success: true,
      message: "Azure AI sync completed",
      total: tenants.length,
      cached: successful,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Azure AI cron job error:", error);
    return NextResponse.json(
      { error: "Internal server error", message: errorMessage(error) },
      { status: 500 }
    );
  }
}
