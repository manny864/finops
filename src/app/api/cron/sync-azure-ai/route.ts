import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import pool from "@/modules/storage/db";
import { errorMessage } from '@/lib/apiErrors';
import { mapWithConcurrency } from "@/modules/collectors/azure/billing/billingHelpers";

// Cuántos tenants se sincronizan a la vez: UNO. Cada uno es un fetch a la PROPIA web (`/api/intelligence/azure-ai`),
// y esa ruta lanza 8 colectores en paralelo, cada uno con su primera consulta a MySQL. Antes iban todos juntos
// (`Promise.allSettled`): con los 5 tenants de hoy son 40 consultas simultáneas contra un pool de 10 conexiones
// y una cola de 20, y las que sobran fallan con `Queue limit reached` (~9.900 veces en 30 días, todas en los
// minutos :13/:33/:53 de este cron). Los colectores atrapan el error y devuelven null: la capability desaparece
// sin ruido, y `getAccessModel` cae a `app_registration`. ponytail: en serie; si el barrido supera los ~200 s de los
// 300 del job, subir a 2-3 y vigilar ese error (los ~2 s por tenant medidos eran del camino que fallaba en la
// autenticación, ver `tenant_id` abajo: con escaneos reales hay que volver a medir).
const MAX_TENANTS_EN_PARALELO = 1;

export async function GET(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get("Authorization") || "";
    const [scheme, token, extra] = authHeader.split(" ");

    if (!cronSecret || cronSecret.length < 16 || scheme !== "Bearer" || !token || extra !== undefined) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const providedHash = crypto.createHash("sha256").update(token).digest();
    const secretHash = crypto.createHash("sha256").update(cronSecret).digest();
    if (!crypto.timingSafeEqual(providedHash, secretHash)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Cron route: authenticated via CRON_SECRET Bearer above (not a tenant JWT).
    // tenantId here only narrows which Enterprise tenants to sync and is validated
    // against the DB; it never grants tenant-scoped access on its own.
    // eslint-disable-next-line local/no-unauth-tenant-id
    const tenantIdParam = request.nextUrl.searchParams.get("tenantId");
    // `tenant_id` (el GUID de Entra) y no `id` (el autoincremental de la fila): azure-ai resuelve credenciales y cachea
    // por ese identificador, igual que los demás crons. Con `id` los 8 colectores de cada tenant fallaban en la
    // autenticación (AADSTS90002 «Tenant '34' not found») en cada corrida, el caché se llenaba de listas vacías bajo una
    // clave que nadie lee y el job igual terminaba en Succeeded: el cron nunca precalentó nada.
    let tenants: any[] = [];
    if (tenantIdParam) {
      const [rows]: any = await pool.query(
        "SELECT tenant_id AS id FROM Tenants WHERE (id = ? OR tenant_id = ?) AND tier = 'Enterprise' LIMIT 1",
        [tenantIdParam, tenantIdParam]
      );
      tenants = rows || [];
    } else {
      const [rows]: any = await pool.query(
        "SELECT tenant_id AS id FROM Tenants WHERE tier = 'Enterprise' LIMIT 100"
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
            headers: { "X-Cron-Auth": cronSecret },
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
