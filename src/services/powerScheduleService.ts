import pool from "@/modules/storage/db";
import { deallocateVirtualMachine, startVirtualMachine, restartVirtualMachine } from "@/services/remediationService";
import { getAzureCredential } from "@/lib/azure";
import { MonitorClient } from "@azure/arm-monitor";

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
  /** "HH:MM" en hora local segun gmtOffset. */
  shutdownTime: string;
  /** Formato "+HH:MM" o "-HH:MM". */
  gmtOffset: string;
  /** "YYYY-MM-DD" — si se define, ejecuta UNA sola vez en esa fecha local en
   *  vez de todos los días (recurrente, el comportamiento por defecto). */
  scheduleDate?: string | null;
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
  schedule_date: string | null;
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
  await pool.query(
    `INSERT INTO PowerSchedules
      (tenant_id, subscription_id, resource_group, vm_name, action_type, shutdown_time, gmt_offset, schedule_date,
       enabled, smart_shutdown_enabled, max_cpu_percentage, idle_duration_minutes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       shutdown_time = VALUES(shutdown_time),
       gmt_offset = VALUES(gmt_offset),
       schedule_date = VALUES(schedule_date),
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
      input.scheduleDate || null,
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

function parseOffsetMinutes(offset: string): number {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(String(offset).trim());
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

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
 * Ejecuta los schedules cuyo horario local (shutdown_time + gmt_offset) cayó
 * dentro de la ventana [scheduled, scheduled + windowMinutes] y que todavía
 * no fueron ejecutados hoy (según la fecha local del schedule).
 *
 * Diseñado para ser invocado por un cron externo cada ~10 min (mismo patrón
 * que /api/cron/prewarm-dashboard). windowMinutes > cadencia del cron para
 * no dejar huecos entre invocaciones.
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
    const offsetMin = parseOffsetMinutes(s.gmt_offset);
    const localNow = new Date(nowUtc.getTime() + offsetMin * 60000);
    const localDateStr = localNow.toISOString().slice(0, 10);

    if (s.last_executed_date && String(s.last_executed_date).slice(0, 10) === localDateStr) {
      continue; // Ya evaluado/ejecutado hoy (fecha local del schedule).
    }

    // One-off: si schedule_date está seteado, solo corre ese día puntual (no
    // recurrente). Si la fecha local todavía no llegó, o ya pasó (y por ende
    // nunca se ejecutó — el cron estuvo caído, por ejemplo), no se ejecuta.
    if (s.schedule_date && String(s.schedule_date).slice(0, 10) !== localDateStr) {
      continue;
    }

    const [hh, mm] = String(s.shutdown_time).split(":").map((n) => parseInt(n, 10));
    const scheduledLocal = new Date(localNow);
    scheduledLocal.setHours(hh || 0, mm || 0, 0, 0);

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
