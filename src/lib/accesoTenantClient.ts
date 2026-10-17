import { MOTIVOS_DE_ACCESO, type AccesoDelTenant, type AccesoDenegado, type MotivoDeAcceso } from "@/types/accesoTenant.types";

/**
 * STRIDE-03 — lado cliente del acceso a un tenant. Sin React ni MSAL, para poder probarlo: `TenantProvider` sólo decide
 * cuándo llamar y qué hacer con el resultado.
 *
 * Regla de oro: ante cualquier duda NO se asume una negativa. Sin red, sin token, una respuesta rota o un motivo que esta
 * versión del cliente no conoce devuelven `null` («no se pudo saber»), nunca un bloqueo.
 */

const esMotivo = (v: unknown): v is MotivoDeAcceso => typeof v === "string" && (MOTIVOS_DE_ACCESO as readonly string[]).includes(v);

function aAccesoDenegado(raw: unknown): AccesoDenegado | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { motivo?: unknown; tier?: unknown; limite?: unknown };
  if (!esMotivo(r.motivo)) return null;
  return {
    motivo: r.motivo,
    ...(typeof r.tier === "string" ? { tier: r.tier } : {}),
    ...(typeof r.limite === "number" && Number.isFinite(r.limite) ? { limite: r.limite } : {}),
  };
}

/** `GET /api/me/acceso`. `null` = no se pudo saber (no es una negativa). */
export async function consultarAcceso(
  tenantId: string,
  idToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AccesoDelTenant | null> {
  try {
    const res = await fetchImpl(`/api/me/acceso?tenantId=${encodeURIComponent(tenantId)}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) return null;
    const acceso = (await res.json())?.acceso;
    if (acceso?.ok === true) return { ok: true };
    if (acceso?.ok === false) {
      const denegado = aAccesoDenegado(acceso);
      return denegado ? { ok: false, ...denegado } : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * El motivo que `GET /api/tenants` agrega cuando el usuario no ve ningún tenant. SIN_SUSCRIPCION devuelve `null` a
 * propósito: sigue yendo a la pantalla de precios (`UnregisteredUserScreen`), no a «sin acceso».
 */
export function accesoDeLaListaDeTenants(data: unknown): AccesoDenegado | null {
  const acceso = aAccesoDenegado((data as { acceso?: unknown } | null)?.acceso);
  return acceso && acceso.motivo !== "SIN_SUSCRIPCION" ? acceso : null;
}
