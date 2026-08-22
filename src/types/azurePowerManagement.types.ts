/**
 * Contratos TypeScript — Control de Máquinas Virtuales y Horarios de Apagado.
 *
 * Nota de persistencia: la tabla real es `PowerSchedules` (migraciones
 * 20260702-003, 20260714-002, 20260716-001, 20260731-001), no una tabla nueva
 * `VmPowerSchedules`. Ya tiene todas las columnas que el módulo necesita
 * (action_type, days_of_week, timezone IANA, schedule_date, smart_shutdown_enabled,
 * max_cpu_percentage, last_execution_status) y es la que consulta el cron
 * `/api/cron/power-schedules`. Duplicarla partiría los datos en dos y dejaría
 * la mitad de los horarios sin motor que los ejecute. Estos tipos son la vista
 * de dominio sobre esa tabla; el mapeo vive en `azureVmPowerManagement.service.ts`.
 */

export type VmPowerAction = "START" | "STOP_DEALLOCATE" | "RESTART";

export type VmScheduleType = "ONE_TIME" | "RECURRING_WEEKLY";

export type VmExecutionStatus = "SUCCESS" | "SKIPPED_BUSY" | "FAILED";

export type VmPowerState = "running" | "deallocated" | "stopped" | "starting";

/** Días en el orden ISO que usa la tabla (1=Lunes .. 7=Domingo). */
export const WEEKDAY_KEYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export const WEEKDAY_LABELS_ES: Record<WeekdayKey, string> = {
  Mon: "Lunes",
  Tue: "Martes",
  Wed: "Miércoles",
  Thu: "Jueves",
  Fri: "Viernes",
  Sat: "Sábado",
  Sun: "Domingo",
};

/** Iniciales para las pills del selector de días. */
export const WEEKDAY_INITIALS_ES: Record<WeekdayKey, string> = {
  Mon: "L",
  Tue: "M",
  Wed: "M",
  Thu: "J",
  Fri: "V",
  Sat: "S",
  Sun: "D",
};

export const BUSINESS_DAYS: WeekdayKey[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export const DEFAULT_TIMEZONE = "America/Argentina/Buenos_Aires";

export const DEFAULT_CPU_THRESHOLD_PERCENTAGE = 5;

/** Semanas por mes usadas en la proyección de ahorro (52 / 12). */
export const WEEKS_PER_MONTH = 4.33;

export const HOURS_PER_WEEK = 168;

export interface TimezoneOption {
  value: string;
  label: string;
}

/** Zonas ofrecidas en el formulario. `value` es IANA: sobrevive al horario de verano. */
export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { value: "America/Argentina/Buenos_Aires", label: "GMT-03:00 · ART / BRT (Buenos Aires, São Paulo)" },
  { value: "America/Santiago", label: "GMT-04:00 · CLT (Santiago)" },
  { value: "America/Bogota", label: "GMT-05:00 · COT (Bogotá, Lima)" },
  { value: "America/Mexico_City", label: "GMT-06:00 · CST (Ciudad de México)" },
  { value: "America/New_York", label: "GMT-05:00 · EST (Nueva York)" },
  { value: "UTC", label: "GMT+00:00 · UTC" },
  { value: "Europe/Madrid", label: "GMT+01:00 · CET (Madrid)" },
];

export interface VmPowerScheduleItem {
  id: string;
  vmResourceId: string;
  vmName: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  action: VmPowerAction;
  scheduleType: VmScheduleType;
  /** "HH:mm" en hora local de `timezone`. */
  time: string;
  daysOfWeek: WeekdayKey[];
  /** "YYYY-MM-DD" cuando scheduleType es ONE_TIME. */
  scheduleDate?: string | null;
  timezone: string;
  /** Etiqueta legible del offset vigente, ej. "GMT-03:00". */
  timezoneLabel: string;
  smartShutdownEnabled: boolean;
  cpuThresholdPercentage: number;
  lastExecutionDate?: string;
  lastExecutionStatus?: VmExecutionStatus;
  lastExecutionError?: string | null;
}

export interface VmInventoryItem {
  id: string;
  name: string;
  resourceGroup: string;
  subscriptionId: string;
  subscriptionName: string;
  location: string;
  vmSize: string;
  powerState: VmPowerState;
  currentCpuPercentage: number;
  monthlySpendUSD: number;
  /** Ahorro que se lograría apagándola fuera de horario laboral. */
  offHoursPotentialSavingsUSD: number;
  hasActiveSchedule: boolean;
  /** Horas semanales que sus horarios activos la dejan apagada. 0 si no tiene. */
  scheduledOffHoursPerWeek: number;
}

export interface PowerManagementSummaryMetrics {
  totalOffHoursSavingsMonthlyUSD: number;
  activeSchedulesCount: number;
  runningVmsCount: number;
  deallocatedVmsCount: number;
  totalMonthlyAvoidedHours: number;
  smartShutdownAvoidedOutagesCount: number;
  /** Ahorro adicional disponible en las VMs encendidas sin horario. */
  untappedSavingsMonthlyUSD: number;
  schedules: VmPowerScheduleItem[];
  vms: VmInventoryItem[];
}

export interface PowerManagementPayload {
  summary: PowerManagementSummaryMetrics;
  source: "live" | "mock";
  lastUpdated: string;
  /** Suscripciones visibles, para el filtro. */
  availableSubscriptions: Array<{ id: string; name: string }>;
}

export interface VmActionPayload {
  vmResourceIds: string[];
  action: VmPowerAction;
}

export interface TableColumnConfig {
  id: string;
  label: string;
  visible: boolean;
  minWidth: number;
}

export const SCHEDULE_COLUMNS: TableColumnConfig[] = [
  { id: "vm", label: "Máquina Virtual", visible: true, minWidth: 200 },
  { id: "action", label: "Acción Programada", visible: true, minWidth: 150 },
  { id: "time", label: "Hora", visible: true, minWidth: 100 },
  { id: "frequency", label: "Frecuencia / Días", visible: true, minWidth: 190 },
  { id: "timezone", label: "Zona Horaria", visible: true, minWidth: 130 },
  { id: "smart", label: "Smart Shutdown", visible: true, minWidth: 160 },
  { id: "lastRun", label: "Última Ejecución", visible: true, minWidth: 200 },
  { id: "actions", label: "Acciones", visible: true, minWidth: 100 },
];

export const INVENTORY_COLUMNS: TableColumnConfig[] = [
  { id: "vm", label: "Máquina Virtual", visible: true, minWidth: 200 },
  { id: "subscription", label: "Suscripción", visible: true, minWidth: 160 },
  { id: "resourceGroup", label: "Grupo de Recursos", visible: true, minWidth: 160 },
  { id: "region", label: "Región", visible: true, minWidth: 110 },
  { id: "size", label: "Tamaño de Instancia", visible: true, minWidth: 160 },
  { id: "cpu", label: "Consumo de CPU", visible: true, minWidth: 150 },
  { id: "spend", label: "Gasto Mensual", visible: true, minWidth: 130 },
  { id: "savings", label: "Ahorro Off-Hours", visible: true, minWidth: 150 },
  { id: "state", label: "Estado en Vivo", visible: true, minWidth: 130 },
  { id: "actions", label: "Acciones Rápidas", visible: true, minWidth: 230 },
];

export const ACTION_LABELS_ES: Record<VmPowerAction, string> = {
  START: "Encender",
  STOP_DEALLOCATE: "Apagar (Deallocate)",
  RESTART: "Reiniciar",
};

export const EXECUTION_STATUS_LABELS_ES: Record<VmExecutionStatus, string> = {
  SUCCESS: "Exitoso",
  SKIPPED_BUSY: "Omitido (CPU en uso)",
  FAILED: "Fallido",
};
