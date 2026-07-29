import pool from "@/modules/storage/db";
import { deallocateVirtualMachine, startVirtualMachine, restartVirtualMachine } from "@/services/remediationService";
import { getAzureCredential } from "@/lib/azure";
import { MonitorClient } from "@azure/arm-monitor";
import { effectiveOffsetMinutes, parseOffsetMinutes as parseOffset } from "@/lib/timezone";

export type PowerScheduleAction = "shutdown" | "start" | "restart";

/**
 * Power Schedules: apagado programado de VMs.
 *
 * Antes esta feature era un stub de UI (PowerSchedules.tsx llamaba a un
 * `alert()` que decia "enviado al engine" sin persistir ni ejecutar nada
 * realmente). Este servicio persiste un schedule por VM en MySQL y expone
 * `executeDueSchedules()`, que el cron `/api/cron/power-schedules` invoca
 * periodicamente (ver README.md, seccion Cron Jobs) para apagar las VMs
 * cuyo horario local ya se cumplio.
 */

export interface PowerScheduleInput {
  tenantId: string;
  subscriptionId: string;
  resourceGroup: string;
  vmName: string;
  /** Acción a ejecutar. Default 'shutdown' (compatibilidad con schedules viejos). */
  actionType?: PowerScheduleAction;
  /** "HH:MM" en hora local segun timeZone (o gmtOffset si no hay zona). */
  shutdownTime: string;
  /** Formato "+HH:MM" o "-HH:MM". Legado: no contempla horario de verano. */
  gmtOffset: string;
  /** Nombre IANA (ej. "Europe/Madrid"). Gana sobre gmtOffset: es el único que
   *  recalcula el offset en cada ejecución y por lo tanto sobrevive al DST. */
  timeZone?: string | null;
  /** "YYYY-MM-DD" — si se define, ejecuta UNA sola vez en esa fecha local en
   *  vez de todos los días (recurrente, el comportamiento por defecto). */
  scheduleDate?: string | null;
  /** CSV de días ISO (1=Lunes..7=Domingo), ej. "1,2,3,4,5". Ignorado si
   *  scheduleDate está seteado (una fecha puntual ya define el día). NULL =
   *  todos los días (comportamiento anterior). */
  daysOfWeek?: string | null;
  /** Solo aplica a actionType='shutdown'. */
  smartShutdownEnabled?: boolean;
  maxCpuPercentage?: number;
  idleDurationMinutes?: number;
  createdBy?: string;
}

export interface PowerScheduleRow {
  id: number;
  tenant_id: string;
  subscription_id: string;
  resource_group: string;
  vm_name: string;
  action_type: PowerScheduleAction;
  shutdown_time: string;
  gmt_offset: string;
  timezone: string | null;
  schedule_date: string | null;
  days_of_week: string | null;
  enabled: number;
  smart_shutdown_enabled: number;
  max_cpu_percentage: number;
  idle_duration_minutes: number;
  last_executed_date: string | null;
  last_execution_status: string | null;
  last_execution_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function upsertPowerSchedule(input: PowerScheduleInput): Promise<void> {
  const actionType = input.actionType || "shutdown";
  // scheduleDate (fecha puntual) y daysOfWeek (recurrencia semanal) son
  // mutuamente excluyentes — una fecha específica ya define un único día, no
  // tiene sentido filtrar además por día de semana. scheduleDate gana.
  const daysOfWeek = input.scheduleDate ? null : (input.daysOfWeek || null);
  await pool.query(
    `INSERT INTO PowerSchedules
      (tenant_id, subscription_id, resource_group, vm_name, action_type, shutdown_time, gmt_offset, timezone, schedule_date,
       days_of_week, enabled, smart_shutdown_enabled, max_cpu_percentage, idle_duration_minutes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       shutdown_time = VALUES(shutdown_time),
       gmt_offset = VALUES(gmt_offset),
       timezone = VALUES(timezone),
       schedule_date = VALUES(schedule_date),
       days_of_week = VALUES(days_of_week),
       enabled = 1,
       smart_shutdown_enabled = VALUES(smart_shutdown_enabled),
       max_cpu_percentage = VALUES(max_cpu_percentage),
       idle_duration_minutes = VALUES(idle_duration_minutes),
       last_executed_date = NULL,
       last_execution_status = NULL,
       last_execution_error = NULL`,
    [
      input.tenantId,
      input.subscriptionId,
      input.resourceGroup,
      input.vmName,
      actionType,
      `${input.shutdownTime}:00`,
      input.gmtOffset,
      input.timeZone || null,
      input.scheduleDate || null,
      daysOfWeek,
      actionType === "shutdown" && input.smartShutdownEnabled ? 1 : 0,
      input.maxCpuPercentage ?? 10,
      input.idleDurationMinutes ?? 60,
      input.createdBy ?? null,
    ]
  );
}

export async function listPowerSchedules(tenantId: string): Promise<PowerScheduleRow[]> {
  const [rows] = await pool.query<any[]>(
    `SELECT * FROM PowerSchedules WHERE tenant_id = ? ORDER BY vm_name ASC`,
    [tenantId]
  );
  return (rows || []) as PowerScheduleRow[];
}

export async function deletePowerSchedule(tenantId: string, id: number): Promise<void> {
  await pool.query(`DELETE FROM PowerSchedules WHERE tenant_id = ? AND id = ?`, [tenantId, id]);
}

/** Reexport por compatibilidad: la implementación vive en @/lib/timezone. */
export const parseOffsetMinutes = parseOffset;

async function isVmCpuBelowThreshold(
  tenantId: string,
  subscriptionId: string,
  resourceGroup: string,
  vmName: string,
  maxCpuPercentage: number,
  idleDurationMinutes: number
): Promise<boolean> {
  try {
    const credential = await getAzureCredential(tenantId);
    const monitorClient = new MonitorClient(credential, subscriptionId);
    const resourceUri = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}`;
    const now = new Date();
    const past = new Date(now.getTime() - idleDurationMinutes * 60000);
    const timespan = `${past.toISOString()}/${now.toISOString()}`;

    const metrics = await monitorClient.metrics.list(resourceUri, {
      timespan,
      interval: "PT5M",
      metricnames: "Percentage CPU",
    });

    let avgCpu = 0;
    let count = 0;
    const series = metrics.value?.[0]?.timeseries?.[0]?.data || [];
    for (const point of series) {
      if (point.average !== undefined) {
        avgCpu += point.average;
        count++;
      }
    }
    if (count === 0) return true; // Sin datos de métricas: no bloqueamos el apagado.
    return avgCpu / count <= maxCpuPercentage;
  } catch (e) {
    console.warn(
      `[PowerSchedule] No se pudo evaluar CPU de ${vmName}, se procede a apagar igual:`,
      (e as Error)?.message || e
    );
    return true;
  }
}

/**
 * mysql2 devuelve columnas DATE como objetos `Date` de JS (no strings), salvo
 * que el pool se configure con `dateStrings: true` (no es el caso acá). Sobre
 * ese objeto, `String(date)` invoca `Date.prototype.toString()` — el formato
 * "Wed Jul 15 2026 00:00:00 GMT-0300 (...)", NO el ISO — así que comparar
 * `String(schedule_date).slice(0, 10)` contra un "YYYY-MM-DD" NUNCA matcheaba,
 * dejando cualquier horario "one-off" (fecha específica) permanentemente
 * inejecutable, en cualquier entorno (no depende de la TZ del proceso — a
 * diferencia del bug de `setHours` de más abajo). Se normaliza con los
 * componentes LOCALES del objeto (mismos con los que mysql2 lo construyó en
 * este mismo proceso), no con `toISOString()` (que podría cruzar de día
 * según el offset).
 */
function toDateOnlyString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

/**
 * Ejecuta los schedules cuyo horario local (shutdown_time + gmt_offset) cayó
 * dentro de la ventana [scheduled, scheduled + windowMinutes] y que todavía
 * no fueron ejecutados hoy (según la fecha local del schedule).
 *
 * Diseñado para ser invocado por un cron externo cada ~2 min (mismo patrón
 * que /api/cron/prewarm-dashboard), y además al instante desde
 * `/api/power/schedule` (POST) apenas se crea/edita un horario.
 * windowMinutes > cadencia del cron para no dejar huecos entre invocaciones.
 */
export async function executeDueSchedules(
  windowMinutes = 15
): Promise<{ evaluated: number; executed: number; skipped: number; failed: number }> {
  const [rows] = await pool.query<any[]>(`SELECT * FROM PowerSchedules WHERE enabled = 1`);
  const schedules = (rows || []) as PowerScheduleRow[];

  const nowUtc = new Date();
  let evaluated = 0;
  let executed = 0;
  let skipped = 0;
  let failed = 0;

  for (const s of schedules) {
    evaluated++;
    // La zona IANA gana sobre el offset fijo y se recalcula en CADA
    // ejecución: por eso un schedule en Madrid sigue apagando a las 20:00
    // locales tanto en invierno como en verano. Las filas viejas sin zona
    // conservan el comportamiento anterior (ver migración 20260731-001).
    const offsetMin = effectiveOffsetMinutes(s.timezone, s.gmt_offset, nowUtc);
    const localNow = new Date(nowUtc.getTime() + offsetMin * 60000);
    const localDateStr = localNow.toISOString().slice(0, 10);

    if (toDateOnlyString(s.last_executed_date) === localDateStr) {
      continue; // Ya evaluado/ejecutado hoy (fecha local del schedule).
    }

    // One-off: si schedule_date está seteado, solo corre ese día puntual (no
    // recurrente). Si la fecha local todavía no llegó, o ya pasó (y por ende
    // nunca se ejecutó — el cron estuvo caído, por ejemplo), no se ejecuta.
    const scheduleDateStr = toDateOnlyString(s.schedule_date);
    if (scheduleDateStr && scheduleDateStr !== localDateStr) {
      continue;
    }

    // Recurrencia por día de semana (solo aplica cuando no es one-off — ver
    // el "gana scheduleDate" en upsertPowerSchedule). getUTCDay() por el
    // mismo motivo que setUTCHours más abajo: `localNow` es un epoch
    // "shifteado" pensado para leerse siempre con métodos UTC, sea cual sea
    // la TZ del proceso. getUTCDay() da 0=Domingo..6=Sábado (convención JS);
    // se convierte a ISO (1=Lunes..7=Domingo) para comparar contra el CSV.
    if (!scheduleDateStr && s.days_of_week) {
      const jsDay = localNow.getUTCDay();
      const isoDay = jsDay === 0 ? 7 : jsDay;
      const allowedDays = String(s.days_of_week).split(",").map((d) => parseInt(d.trim(), 10));
      if (!allowedDays.includes(isoDay)) {
        continue;
      }
    }

    const [hh, mm] = String(s.shutdown_time).split(":").map((n) => parseInt(n, 10));
    const scheduledLocal = new Date(localNow);
    // setUTCHours (NO setHours): `localNow`/`scheduledLocal` son un truco —
    // epoch = UTC real + offset del schedule, pensado para leerse/escribirse
    // SIEMPRE con métodos UTC (independiente de en qué TZ corre el proceso
    // Node). `setHours` usa la TZ del sistema operativo/proceso; si el
    // servidor no corre en UTC (ej. una máquina de desarrollo en
    // America/Buenos_Aires), aplica un segundo desplazamiento de zona
    // horaria encima del ya calculado arriba, rompiendo por completo el
    // cálculo de "horario debido" — los schedules nunca se ejecutan. En el
    // VPS de producción no se nota porque el contenedor corre en UTC
    // (setHours == setUTCHours ahí), pero es un bug real, no solo un
    // problema de "nada dispara el cron en local".
    scheduledLocal.setUTCHours(hh || 0, mm || 0, 0, 0);

    const diffMinutes = (localNow.getTime() - scheduledLocal.getTime()) / 60000;
    // El horario ya debe haber pasado (>=0) pero no hace más de `windowMinutes`
    // (evita ejecutar horas después si el cron estuvo caído).
    if (diffMinutes < 0 || diffMinutes > windowMinutes) continue;

    const actionType: PowerScheduleAction = s.action_type || "shutdown";

    try {
      if (actionType === "shutdown" && s.smart_shutdown_enabled) {
        const belowThreshold = await isVmCpuBelowThreshold(
          s.tenant_id,
          s.subscription_id,
          s.resource_group,
          s.vm_name,
          s.max_cpu_percentage,
          s.idle_duration_minutes
        );
        if (!belowThreshold) {
          skipped++;
          await pool.query(
            `UPDATE PowerSchedules SET last_executed_date = ?, last_execution_status = 'skipped_cpu', last_execution_error = NULL WHERE id = ?`,
            [localDateStr, s.id]
          );
          continue;
        }
      }

      if (actionType === "start") {
        await startVirtualMachine(s.tenant_id, "cron@system", s.subscription_id, s.resource_group, s.vm_name);
      } else if (actionType === "restart") {
        await restartVirtualMachine(s.tenant_id, "cron@system", s.subscription_id, s.resource_group, s.vm_name);
      } else {
        await deallocateVirtualMachine(s.tenant_id, "cron@system", s.subscription_id, s.resource_group, s.vm_name);
      }
      executed++;
      await pool.query(
        `UPDATE PowerSchedules SET last_executed_date = ?, last_execution_status = 'executed', last_execution_error = NULL WHERE id = ?`,
        [localDateStr, s.id]
      );
    } catch (e: any) {
      failed++;
      console.error(`[PowerSchedule] Error ejecutando ${actionType} en VM ${s.vm_name} (tenant ${s.tenant_id}):`, e?.message || e);
      await pool.query(
        `UPDATE PowerSchedules SET last_executed_date = ?, last_execution_status = 'failed', last_execution_error = ? WHERE id = ?`,
        [localDateStr, String(e?.message || e).slice(0, 500), s.id]
      );
    }
  }

  return { evaluated, executed, skipped, failed };
}
