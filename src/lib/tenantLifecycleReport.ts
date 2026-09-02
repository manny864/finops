import type { SuperAdminTenantItem } from "@/types/superAdminTenants.types";

/**
 * MEJ-12, criterio 3: filtro por rango de fechas del ciclo de vida y armado del
 * informe contable. Fuera del componente para poder probarlo sin montar la UI.
 */

export type LifecycleDateField = "activatedAtIso" | "canceledAtIso";

export interface LifecycleRangeFilter {
  /** Sobre qué fecha se filtra: alta o baja. */
  field: LifecycleDateField;
  /** `YYYY-MM-DD` inclusive; vacío = sin límite por ese lado. */
  from?: string;
  to?: string;
}

/**
 * Compara por DÍA y no por instante: el filtro se completa con dos `<input
 * type="date">`, así que "hasta el 30/09" tiene que incluir todo ese día. Con
 * una comparación de timestamps, `to` valdría medianoche y dejaría afuera al
 * tenant que se dio de baja esa misma tarde.
 *
 * Un tenant sin la fecha pedida queda EXCLUIDO cuando hay algún límite: si se
 * pregunta "bajas de septiembre", uno que nunca se dio de baja no es una
 * respuesta vacía, no pertenece al conjunto.
 */
export function filterByLifecycleRange(
  tenants: SuperAdminTenantItem[],
  filter: LifecycleRangeFilter
): SuperAdminTenantItem[] {
  const { field, from, to } = filter;
  if (!from && !to) return tenants;

  return tenants.filter((t) => {
    const iso = t[field];
    if (!iso) return false;
    const day = iso.slice(0, 10); // YYYY-MM-DD, comparable como string
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
}

/** Meses (con decimales) entre el alta y la baja, o entre el alta y hoy. */
export function tenureInMonths(t: SuperAdminTenantItem, now: Date = new Date()): number | null {
  if (!t.activatedAtIso) return null;
  const start = new Date(t.activatedAtIso).getTime();
  const end = t.canceledAtIso ? new Date(t.canceledAtIso).getTime() : now.getTime();
  if (!Number.isFinite(start) || end < start) return null;
  // 30.44 = promedio de días por mes. Un "meses" exacto de calendario no
  // aporta acá: es una permanencia para un informe, no una factura.
  return Number(((end - start) / (1000 * 60 * 60 * 24 * 30.44)).toFixed(1));
}

const CSV_HEADERS = [
  "Tenant ID", "Empresa", "Estado", "Tier",
  "Fecha de Alta", "Fecha de Suspension", "Fecha de Baja", "Motivo de Baja",
  "Permanencia (meses)",
];

/** Un campo CSV seguro: comillas dobladas y el campo entrecomillado si hace
 *  falta. Un nombre de empresa con coma partía la fila en dos. */
function csvField(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildLifecycleCsv(tenants: SuperAdminTenantItem[], now: Date = new Date()): string {
  const rows = tenants.map((t) => [
    t.tenantId,
    t.organizationName,
    t.subscriptionStatus,
    t.planTier,
    t.activatedAtIso?.slice(0, 10) ?? "",
    t.suspendedAtIso?.slice(0, 10) ?? "",
    t.canceledAtIso?.slice(0, 10) ?? "",
    t.cancellationReason ?? "",
    tenureInMonths(t, now) ?? "",
  ].map(csvField).join(","));

  // BOM para que Excel abra los acentos bien: sin él, "Suspensión" llega como
  // "SuspensiÃ³n" en Excel de Windows, que es donde se va a abrir esto.
  return "﻿" + [CSV_HEADERS.join(","), ...rows].join("\r\n");
}
