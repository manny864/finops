import { NextRequest, NextResponse } from "next/server";
import { AuthError, hasSystemRole, requireTenantRole } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from "@/lib/apiErrors";
import { isMockTenant } from "@/lib/mockData";
import rateLimiter from "@/lib/rateLimiter";
import { listarCobros, solicitarReembolso, VENTANA_REEMBOLSO_DIAS } from "@/services/refunds.service";

export const dynamic = "force-dynamic";

const ROLES = ["Admin", "Owner"];

async function esSuperAdmin(identity: { email: string; isCorporateDomain?: boolean }): Promise<boolean> {
  return Boolean(identity.isCorporateDomain) && (await hasSystemRole(identity.email, "SUPERADMIN"));
}

function respuestaError(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: errorMessage(err) }, { status: errorStatus(err) });
  const status = (err as { status?: number })?.status;
  if (status) return NextResponse.json({ error: errorMessage(err) }, { status });
  console.error("[Refunds] Error:", err);
  return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
}

/**
 * GET /api/billing/refunds?tenantId=
 * Cobros del tenant con si se pueden reembolsar, cuánto se devolvería hoy (prorrateo) y, si no, por qué. Admin/Owner del tenant o SuperAdmin.
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) return NextResponse.json({ error: "tenantId es requerido" }, { status: 400 });

    const identity = await requireTenantRole(request, tenantId, ROLES);
    if (isMockTenant(tenantId)) return NextResponse.json({ success: true, cobros: [], ventanaDias: VENTANA_REEMBOLSO_DIAS });

    const superAdmin = await esSuperAdmin(identity);
    return NextResponse.json({
      success: true,
      cobros: await listarCobros(tenantId, superAdmin),
      ventanaDias: superAdmin ? null : VENTANA_REEMBOLSO_DIAS,
    });
  } catch (err) {
    return respuestaError(err);
  }
}

/**
 * POST /api/billing/refunds   { tenantId, transactionId, reason, modo? }
 * Pide a Paddle el reembolso de un cobro: PROPORCIONAL por los días no usados (por omisión) o `modo: "total"` (sólo SuperAdmin). Los efectos en la plataforma los aplica el webhook cuando Paddle lo aprueba.
 */
export async function POST(request: NextRequest) {
  try {
    const { tenantId, transactionId, reason, modo } = await request.json().catch(() => ({}));
    if (!tenantId || typeof transactionId !== "string" || typeof reason !== "string") {
      return NextResponse.json({ error: "tenantId, transactionId y reason son requeridos" }, { status: 400 });
    }
    if (modo !== undefined && modo !== "proporcional" && modo !== "total") {
      return NextResponse.json({ error: "modo debe ser 'proporcional' o 'total'" }, { status: 400 });
    }
    if (!/^txn_[a-z0-9]{26}$/.test(transactionId)) {
      return NextResponse.json({ error: "transactionId inválido" }, { status: 400 });
    }

    const identity = await requireTenantRole(request, tenantId, ROLES);
    if (isMockTenant(tenantId)) {
      return NextResponse.json({ error: "Un tenant demo no tiene cobros reales que reembolsar." }, { status: 400 });
    }

    // Plata que sale: 5 pedidos por minuto y por (tenant, usuario) alcanzan de sobra para un humano.
    const rl = await rateLimiter.checkByKeyDistributed(`refund:${tenantId}:${identity.email}`, 5, 60_000);
    if (!rl.allowed) {
      return NextResponse.json({ error: `Demasiados pedidos. Reintentá después de ${rl.resetAt.toISOString()}.` }, { status: 429 });
    }

    const resultado = await solicitarReembolso({
      tenantId,
      transactionId,
      reason,
      email: identity.email,
      esSuperAdmin: await esSuperAdmin(identity),
      modo,
    });
    return NextResponse.json({ success: true, ...resultado });
  } catch (err) {
    return respuestaError(err);
  }
}
