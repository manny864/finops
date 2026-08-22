/**
 * Control de Máquinas Virtuales y Horarios de Apagado — capa de dominio.
 *
 * El motor de ejecución (cron + guard de CPU + resolución de zona horaria) ya
 * vive en `powerScheduleService.ts` y no se duplica acá. Este servicio se
 * ocupa de lo que faltaba: traducir las filas de `PowerSchedules` al contrato
 * del módulo, calcular el ahorro fuera de horario y armar el resumen.
 *
 * RBAC Azure mínimo: `Reader` (inventario ARG) + `Monitoring Reader` (métrica
 * Percentage CPU) para la vista; `Virtual Machine Contributor` sólo para las
 * acciones start/stop/restart, que se ejecutan en `/api/power`.
 */

import Decimal from "decimal.js";
import { formatOffset, offsetMinutesFor, normalizeTimeZone } from "@/lib/timezone";
import { errorMessage } from "@/lib/apiErrors";
import {
  BUSINESS_DAYS,
  DEFAULT_CPU_THRESHOLD_PERCENTAGE,
  DEFAULT_TIMEZONE,
  HOURS_PER_WEEK,
  WEEKDAY_KEYS,
  WEEKS_PER_MONTH,
  type PowerManagementPayload,
  type PowerManagementSummaryMetrics,
  type VmExecutionStatus,
  type VmInventoryItem,
  type VmPowerAction,
  type VmPowerScheduleItem,
  type VmPowerState,
  type VmScheduleType,
  type WeekdayKey,
} from "@/types/azurePowerManagement.types";

// ─────────────────────────────────────────────────────────────────────────────
// Mapeo entre la fila de MySQL y el contrato del módulo
// ─────────────────────────────────────────────────────────────────────────────

/** Fila cruda de `PowerSchedules` (ver powerScheduleService.PowerScheduleRow). */
export interface RawScheduleRow {
  id: number | string;
  subscription_id: string;
  resource_group: string;
  vm_name: string;
  action_type?: string | null;
  shutdown_time: string;
  gmt_offset?: string | null;
  timezone?: string | null;
  schedule_date?: unknown;
  days_of_week?: string | null;
  smart_shutdown_enabled?: number | boolean | null;
  max_cpu_percentage?: number | null;
  last_executed_date?: unknown;
  last_execution_status?: string | null;
  last_execution_error?: string | null;
}

const ACTION_FROM_DB: Record<string, VmPowerAction> = {
  shutdown: "STOP_DEALLOCATE",
  start: "START",
  restart: "RESTART",
};

const ACTION_TO_DB: Record<VmPowerAction, string> = {
  STOP_DEALLOCATE: "shutdown",
  START: "start",
  RESTART: "restart",
};

/**
 * La tabla guarda tres estados propios (`executed`, `skipped_cpu`, `failed`).
 * Se traducen al vocabulario del módulo en vez de exponer el interno: la UI no
 * debería tener que conocer el esquema.
 */
const STATUS_FROM_DB: Record<string, VmExecutionStatus> = {
  executed: "SUCCESS",
  skipped_cpu: "SKIPPED_BUSY",
  failed: "FAILED",
};

export function toDbAction(action: VmPowerAction): string {
  return ACTION_TO_DB[action] || "shutdown";
}

export function fromDbAction(raw: unknown): VmPowerAction {
  return ACTION_FROM_DB[String(raw || "shutdown").toLowerCase()] || "STOP_DEALLOCATE";
}

export function fromDbStatus(raw: unknown): VmExecutionStatus | undefined {
  if (!raw) return undefined;
  return STATUS_FROM_DB[String(raw).toLowerCase()];
}

/** CSV de días ISO ("1,2,3,4,5") → claves de día. Vacío = todos los días. */
export function parseDaysOfWeek(csv: unknown): WeekdayKey[] {
  const raw = String(csv ?? "").trim();
  if (!raw) return [...WEEKDAY_KEYS];
  const out: WeekdayKey[] = [];
  for (const part of raw.split(",")) {
    const n = parseInt(part.trim(), 10);
    if (n >= 1 && n <= 7) {
      const key = WEEKDAY_KEYS[n - 1];
      if (!out.includes(key)) out.push(key);
    }
  }
  return out.length > 0 ? out : [...WEEKDAY_KEYS];
}

/** Claves de día → CSV ISO. Devuelve null si están los siete (= sin filtro). */
export function serializeDaysOfWeek(days: WeekdayKey[]): string | null {
  const unique = WEEKDAY_KEYS.filter((d) => days.includes(d));
  if (unique.length === 0 || unique.length === WEEKDAY_KEYS.length) return null;
  return unique.map((d) => WEEKDAY_KEYS.indexOf(d) + 1).join(",");
}

/**
 * mysql2 devuelve DATE como objeto `Date`, y `String(date)` da el formato largo
 * de `toString()`, no ISO. Se normaliza con los componentes locales (los mismos
 * con los que mysql2 lo construyó), no con toISOString(), que puede cruzar de
 * día según el offset del proceso.
 */
export function toDateOnly(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : null;
}

/** "18:30:00" → "18:30". */
export function toHhMm(value: unknown): string {
  const s = String(value ?? "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "00:00";
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

export function mapScheduleRow(
  row: RawScheduleRow,
  subscriptionNames: Map<string, string> = new Map()
): VmPowerScheduleItem {
  const timezone = normalizeTimeZone(row.timezone || DEFAULT_TIMEZONE);
  const scheduleDate = toDateOnly(row.schedule_date);
  const subId = String(row.subscription_id || "");
  return {
    id: String(row.id),
    vmResourceId: `/subscriptions/${subId}/resourceGroups/${row.resource_group}/providers/Microsoft.Compute/virtualMachines/${row.vm_name}`,
    vmName: String(row.vm_name || ""),
    resourceGroup: String(row.resource_group || ""),
    subscriptionId: subId,
    subscriptionName: subscriptionNames.get(subId.toLowerCase()) || subId,
    action: fromDbAction(row.action_type),
    scheduleType: scheduleDate ? "ONE_TIME" : "RECURRING_WEEKLY",
    time: toHhMm(row.shutdown_time),
    // Una fecha puntual ya define el día: no se le superpone recurrencia semanal.
    daysOfWeek: scheduleDate ? [] : parseDaysOfWeek(row.days_of_week),
    scheduleDate,
    timezone,
    timezoneLabel: `GMT${formatOffset(offsetMinutesFor(timezone))}`,
    smartShutdownEnabled: Boolean(row.smart_shutdown_enabled),
    cpuThresholdPercentage: Number(row.max_cpu_percentage ?? DEFAULT_CPU_THRESHOLD_PERCENTAGE),
    lastExecutionDate: toDateOnly(row.last_executed_date) || undefined,
    lastExecutionStatus: fromDbStatus(row.last_execution_status),
    lastExecutionError: row.last_execution_error || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Motor de ahorro fuera de horario
// ─────────────────────────────────────────────────────────────────────────────

/** "HH:mm" → minutos desde medianoche. */
function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * Horas semanales que una VM queda apagada dado su par de horarios recurrentes.
 *
 * Se calcula recorriendo la semana minuto a minuto en bloques de día en vez de
 * usar una constante: la ventana real depende de qué días tienen apagado, qué
 * días tienen encendido y a qué hora, y un fin de semana sin encendido programado
 * arrastra el apagado del viernes hasta el lunes.
 *
 * NOTA sobre la constante del spec: "L-V 19:00→07:00 + fin de semana completo"
 * NO son 118 h/semana sino **108** (4 noches L-J × 12 h = 48, más viernes 19:00 →
 * lunes 07:00 = 60). Las 118 h saldrían de sumar 5 noches × 12 h y el fin de
 * semana entero por separado, contando dos veces el viernes por la noche y la
 * madrugada del lunes. 168 − 108 = 60 h encendida = 5 días × 12 h, que cierra.
 * Por eso el cálculo es derivado y no una constante: la cifra correcta es 108 h
 * (64,3 % del tiempo apagada), no 118 h (70 %).
 */
export function calcWeeklyOffHours(
  stopSchedule: { time: string; daysOfWeek: WeekdayKey[] } | null,
  startSchedule: { time: string; daysOfWeek: WeekdayKey[] } | null
): number {
  if (!stopSchedule) return 0;

  const stopDays = new Set(stopSchedule.daysOfWeek);
  const startDays = new Set(startSchedule?.daysOfWeek || []);
  if (stopDays.size === 0) return 0;

  const stopMin = minutesOfDay(stopSchedule.time);
  const startMin = startSchedule ? minutesOfDay(startSchedule.time) : null;

  // Se marca la semana en minutos (7 × 1440) y se recorre desde cada apagado
  // hasta el siguiente encendido. Es O(10080) por VM: irrelevante, y evita
  // razonar a mano sobre los cruces de medianoche y de fin de semana.
  const WEEK_MINUTES = 7 * 1440;
  const off = new Uint8Array(WEEK_MINUTES);

  for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
    const day = WEEKDAY_KEYS[dayIdx];
    if (!stopDays.has(day)) continue;
    const from = dayIdx * 1440 + stopMin;

    for (let step = 1; step <= WEEK_MINUTES; step++) {
      const abs = from + step - 1;
      const cursor = abs % WEEK_MINUTES;
      // ¿Hay un encendido programado exactamente en este minuto?
      if (startMin !== null) {
        const cursorDay = WEEKDAY_KEYS[Math.floor(cursor / 1440)];
        if (startDays.has(cursorDay) && cursor % 1440 === startMin) break;
      }
      off[cursor] = 1;
    }
  }

  let minutes = 0;
  for (let i = 0; i < WEEK_MINUTES; i++) minutes += off[i];
  return Number((minutes / 60).toFixed(2));
}

/** Ventana por defecto para la proyección de VMs sin horario: L-V 19:00 → 07:00. */
export const DEFAULT_OFF_HOURS_PER_WEEK = calcWeeklyOffHours(
  { time: "19:00", daysOfWeek: BUSINESS_DAYS },
  { time: "07:00", daysOfWeek: BUSINESS_DAYS }
);

/**
 * Ahorro mensual de apagar una VM `offHoursPerWeek` horas por semana.
 * Regla Cero: la aritmética va en Decimal, no en float.
 */
export function calcMonthlySavings(hourlyRateUSD: number, offHoursPerWeek: number): number {
  if (hourlyRateUSD <= 0 || offHoursPerWeek <= 0) return 0;
  return new Decimal(hourlyRateUSD)
    .times(Math.min(offHoursPerWeek, HOURS_PER_WEEK))
    .times(WEEKS_PER_MONTH)
    .toDecimalPlaces(2)
    .toNumber();
}

/**
 * Tarifa horaria de cómputo. Se prefiere el precio de lista (PAYG) porque no
 * depende de cuántas horas corrió la VM este mes; si no hay precio se deriva
 * del gasto real repartido sobre las horas efectivamente encendida. Derivar
 * sobre 730 h fijas subestimaría la tarifa de una VM que ya se apaga de noche
 * y haría ver su ahorro actual como si fuera menor de lo que es.
 */
export function resolveHourlyRate(
  listPriceHourlyUSD: number,
  monthlySpendUSD: number,
  billedHoursThisMonth: number
): number {
  if (listPriceHourlyUSD > 0) return listPriceHourlyUSD;
  if (monthlySpendUSD > 0 && billedHoursThisMonth > 0) {
    return new Decimal(monthlySpendUSD).div(billedHoursThisMonth).toDecimalPlaces(6).toNumber();
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ensamblado del resumen
// ─────────────────────────────────────────────────────────────────────────────

/** Empareja los horarios de una VM y devuelve sus horas apagada por semana. */
export function offHoursForVm(vmName: string, schedules: VmPowerScheduleItem[]): number {
  const own = schedules.filter((s) => s.vmName === vmName && s.scheduleType === "RECURRING_WEEKLY");
  const stop = own.find((s) => s.action === "STOP_DEALLOCATE");
  const start = own.find((s) => s.action === "START");
  if (!stop) return 0;
  return calcWeeklyOffHours(
    { time: stop.time, daysOfWeek: stop.daysOfWeek },
    start ? { time: start.time, daysOfWeek: start.daysOfWeek } : null
  );
}

export function buildPowerSummary(input: {
  schedules: VmPowerScheduleItem[];
  vms: VmInventoryItem[];
  smartShutdownAvoidedOutagesCount: number;
}): PowerManagementSummaryMetrics {
  const { schedules, vms } = input;

  let savings = new Decimal(0);
  let untapped = new Decimal(0);
  let avoidedHours = new Decimal(0);

  for (const vm of vms) {
    if (vm.scheduledOffHoursPerWeek > 0) {
      savings = savings.plus(vm.offHoursPotentialSavingsUSD);
      avoidedHours = avoidedHours.plus(new Decimal(vm.scheduledOffHoursPerWeek).times(WEEKS_PER_MONTH));
    } else if (vm.powerState === "running") {
      // Sólo cuenta como oportunidad si está prendida: una VM ya desasignada
      // no tiene nada más que ahorrar apagándola.
      untapped = untapped.plus(vm.offHoursPotentialSavingsUSD);
    }
  }

  return {
    totalOffHoursSavingsMonthlyUSD: savings.toDecimalPlaces(2).toNumber(),
    untappedSavingsMonthlyUSD: untapped.toDecimalPlaces(2).toNumber(),
    activeSchedulesCount: new Set(schedules.map((s) => s.vmName)).size,
    runningVmsCount: vms.filter((v) => v.powerState === "running").length,
    deallocatedVmsCount: vms.filter((v) => v.powerState === "deallocated" || v.powerState === "stopped").length,
    totalMonthlyAvoidedHours: avoidedHours.toDecimalPlaces(1).toNumber(),
    smartShutdownAvoidedOutagesCount: input.smartShutdownAvoidedOutagesCount,
    schedules,
    vms,
  };
}

/** Normaliza el `powerState` que devuelve Resource Graph. */
export function normalizePowerState(raw: unknown): VmPowerState {
  const s = String(raw || "").toLowerCase();
  if (s.includes("running")) return "running";
  if (s.includes("deallocat")) return "deallocated";
  if (s.includes("starting")) return "starting";
  if (s.includes("stopped")) return "stopped";
  return "stopped";
}

export function assembleLivePowerManagement(input: {
  schedules: VmPowerScheduleItem[];
  vms: VmInventoryItem[];
  availableSubscriptions: Array<{ id: string; name: string }>;
  smartShutdownAvoidedOutagesCount: number;
}): PowerManagementPayload {
  try {
    return {
      summary: buildPowerSummary(input),
      source: "live",
      lastUpdated: new Date().toISOString(),
      availableSubscriptions: input.availableSubscriptions,
    };
  } catch (error) {
    console.error("[azureVmPowerManagement] assembleLivePowerManagement:", errorMessage(error));
    return {
      summary: buildPowerSummary({ schedules: [], vms: [], smartShutdownAvoidedOutagesCount: 0 }),
      source: "live",
      lastUpdated: new Date().toISOString(),
      availableSubscriptions: [],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset demo
// ─────────────────────────────────────────────────────────────────────────────

function tierOf(tenantId: string): "Professional" | "Business" | "Enterprise" {
  if (tenantId.includes("4444") || tenantId.includes("enterprise")) return "Enterprise";
  if (tenantId.includes("2222") || tenantId.includes("business")) return "Business";
  return "Professional";
}

const DEMO_SUBSCRIPTIONS = [
  { id: "ec03e8ce-ceee-4638-b303-64ae431d5b1e", name: "CSCS-LandingZone" },
  { id: "7b1f9a22-4c31-4d55-b0aa-9e2d6f118c40", name: "CSCS-Produccion" },
  { id: "2ad4c7e1-88b6-4f0e-9c33-1de0b7a5f962", name: "CSCS-Testing-CL" },
];

interface DemoVmSeed {
  name: string;
  rg: string;
  sub: number;
  location: string;
  size: string;
  hourly: number;
  state: VmPowerState;
  cpu: number;
  stop?: { time: string; days: WeekdayKey[] };
  start?: { time: string; days: WeekdayKey[] };
  smart?: boolean;
  lastStatus?: VmExecutionStatus;
}

const DEMO_VMS: DemoVmSeed[] = [
  {
    name: "vm-sap-prod-01", rg: "rg-sap-produccion", sub: 1, location: "eastus",
    size: "Standard_E16s_v5", hourly: 1.008, state: "running", cpu: 42.6,
  },
  {
    name: "vm-jenkins-build", rg: "rg-devops", sub: 0, location: "eastus",
    size: "Standard_D8s_v5", hourly: 0.384, state: "running", cpu: 3.1,
    stop: { time: "20:00", days: BUSINESS_DAYS }, start: { time: "08:00", days: BUSINESS_DAYS },
    smart: true, lastStatus: "SUCCESS",
  },
  {
    name: "vm-qa-selenium-02", rg: "rg-testing", sub: 2, location: "brazilsouth",
    size: "Standard_D4s_v5", hourly: 0.192, state: "deallocated", cpu: 0,
    stop: { time: "19:00", days: BUSINESS_DAYS }, start: { time: "07:00", days: BUSINESS_DAYS },
    smart: true, lastStatus: "SUCCESS",
  },
  {
    name: "vm-dev-sandbox-07", rg: "rg-sandbox", sub: 2, location: "brazilsouth",
    size: "Standard_B4ms", hourly: 0.166, state: "running", cpu: 1.4,
    stop: { time: "18:30", days: BUSINESS_DAYS }, smart: true, lastStatus: "SKIPPED_BUSY",
  },
  {
    name: "vm-analytics-etl", rg: "rg-datalake", sub: 1, location: "westeurope",
    size: "Standard_D16s_v5", hourly: 0.768, state: "running", cpu: 67.9,
  },
  {
    name: "vm-legacy-fileserver", rg: "rg-legacy", sub: 0, location: "eastus",
    size: "Standard_D2s_v5", hourly: 0.096, state: "running", cpu: 0.8,
  },
  {
    name: "vm-training-lab-03", rg: "rg-academy", sub: 2, location: "brazilsouth",
    size: "Standard_B2ms", hourly: 0.083, state: "deallocated", cpu: 0,
    stop: { time: "22:00", days: [...WEEKDAY_KEYS] }, start: { time: "09:00", days: BUSINESS_DAYS },
    lastStatus: "SUCCESS",
  },
  {
    name: "vm-bastion-jump", rg: "rg-networking", sub: 0, location: "eastus",
    size: "Standard_B2s", hourly: 0.0416, state: "running", cpu: 0.3,
  },
  {
    name: "vm-sql-report-replica", rg: "rg-datos", sub: 1, location: "westeurope",
    size: "Standard_E8s_v5", hourly: 0.504, state: "running", cpu: 18.2,
    stop: { time: "21:00", days: BUSINESS_DAYS }, start: { time: "06:00", days: BUSINESS_DAYS },
    smart: true, lastStatus: "FAILED",
  },
  {
    name: "vm-integration-mule", rg: "rg-integracion", sub: 1, location: "eastus",
    size: "Standard_D4s_v5", hourly: 0.192, state: "running", cpu: 12.5,
  },
  {
    name: "vm-batch-nightly", rg: "rg-batch", sub: 0, location: "eastus",
    size: "Standard_F8s_v2", hourly: 0.338, state: "deallocated", cpu: 0,
    stop: { time: "05:00", days: [...WEEKDAY_KEYS] }, start: { time: "23:00", days: [...WEEKDAY_KEYS] },
    lastStatus: "SUCCESS",
  },
  {
    name: "vm-poc-ia-gpu", rg: "rg-ia", sub: 2, location: "eastus",
    size: "Standard_NC6s_v3", hourly: 3.06, state: "running", cpu: 5.4,
  },
];

/** Cuántas VMs ve cada tier en la demo. */
const TIER_VM_COUNT: Record<string, number> = { Professional: 5, Business: 9, Enterprise: 12 };

export function getMockPowerManagementPayload(tenantId: string): PowerManagementPayload {
  const tier = tierOf(tenantId);
  const seeds = DEMO_VMS.slice(0, TIER_VM_COUNT[tier]);

  const schedules: VmPowerScheduleItem[] = [];
  let scheduleId = 1;
  const pushSchedule = (
    seed: DemoVmSeed,
    action: VmPowerAction,
    time: string,
    days: WeekdayKey[],
    smart: boolean
  ) => {
    const sub = DEMO_SUBSCRIPTIONS[seed.sub];
    const timezone = DEFAULT_TIMEZONE;
    schedules.push({
      id: String(scheduleId++),
      vmResourceId: `/subscriptions/${sub.id}/resourceGroups/${seed.rg}/providers/Microsoft.Compute/virtualMachines/${seed.name}`,
      vmName: seed.name,
      resourceGroup: seed.rg,
      subscriptionId: sub.id,
      subscriptionName: sub.name,
      action,
      scheduleType: "RECURRING_WEEKLY",
      time,
      daysOfWeek: days,
      scheduleDate: null,
      timezone,
      timezoneLabel: `GMT${formatOffset(offsetMinutesFor(timezone))}`,
      smartShutdownEnabled: smart,
      cpuThresholdPercentage: DEFAULT_CPU_THRESHOLD_PERCENTAGE,
      lastExecutionDate: seed.lastStatus ? "2026-08-21" : undefined,
      lastExecutionStatus: action === "STOP_DEALLOCATE" ? seed.lastStatus : undefined,
      lastExecutionError:
        action === "STOP_DEALLOCATE" && seed.lastStatus === "FAILED"
          ? "AuthorizationFailed: el Service Principal no tiene Microsoft.Compute/virtualMachines/deallocate"
          : null,
    });
  };

  for (const seed of seeds) {
    if (seed.stop) pushSchedule(seed, "STOP_DEALLOCATE", seed.stop.time, seed.stop.days, Boolean(seed.smart));
    if (seed.start) pushSchedule(seed, "START", seed.start.time, seed.start.days, false);
  }

  const vms: VmInventoryItem[] = seeds.map((seed) => {
    const sub = DEMO_SUBSCRIPTIONS[seed.sub];
    const scheduledOffHours = offHoursForVm(seed.name, schedules);
    // El gasto refleja lo que la VM realmente costaría con su patrón actual.
    const billedHours = new Decimal(HOURS_PER_WEEK).minus(scheduledOffHours).times(WEEKS_PER_MONTH);
    const monthlySpend = new Decimal(seed.hourly).times(billedHours).toDecimalPlaces(2).toNumber();
    return {
      id: `/subscriptions/${sub.id}/resourceGroups/${seed.rg}/providers/Microsoft.Compute/virtualMachines/${seed.name}`,
      name: seed.name,
      resourceGroup: seed.rg,
      subscriptionId: sub.id,
      subscriptionName: sub.name,
      location: seed.location,
      vmSize: seed.size,
      powerState: seed.state,
      currentCpuPercentage: seed.cpu,
      monthlySpendUSD: monthlySpend,
      offHoursPotentialSavingsUSD: calcMonthlySavings(
        seed.hourly,
        scheduledOffHours > 0 ? scheduledOffHours : DEFAULT_OFF_HOURS_PER_WEEK
      ),
      hasActiveSchedule: scheduledOffHours > 0 || schedules.some((s) => s.vmName === seed.name),
      scheduledOffHoursPerWeek: scheduledOffHours,
    };
  });

  return {
    summary: buildPowerSummary({
      schedules,
      vms,
      smartShutdownAvoidedOutagesCount: schedules.filter((s) => s.lastExecutionStatus === "SKIPPED_BUSY").length,
    }),
    source: "mock",
    lastUpdated: "2026-08-22T09:00:00.000Z",
    availableSubscriptions: DEMO_SUBSCRIPTIONS.filter((_, i) => seeds.some((s) => s.sub === i)),
  };
}

/** Tipos re-exportados para que las rutas no tengan que importar de dos lados. */
export type { VmScheduleType };
