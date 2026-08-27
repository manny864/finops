"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useMsal } from "@azure/msal-react";
import { toast } from "sonner";
import {
  IconCash,
  IconCalendarTime,
  IconPlayerPlay,
  IconClockCheck,
  IconClock,
  IconPlus,
  IconTrash,
  IconServer,
  IconDeviceDesktopAnalytics,
  IconPower,
  IconRotateClockwise,
  IconColumns,
  IconCpu,
  IconAdjustments,
  IconSearch,
  IconAlertTriangle,
  IconCheck,
  IconX,
  IconSparkles,
  IconCircleCheck,
  IconCircleX,
} from "@tabler/icons-react";
import { useTenant } from "@/components/TenantProvider";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
import ResizableTh from "@/components/ResizableTh";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import {
  ACTION_LABELS_ES,
  BUSINESS_DAYS,
  DEFAULT_CPU_THRESHOLD_PERCENTAGE,
  DEFAULT_TIMEZONE,
  EXECUTION_STATUS_LABELS_ES,
  INVENTORY_COLUMNS,
  SCHEDULE_COLUMNS,
  TIMEZONE_OPTIONS,
  WEEKDAY_INITIALS_ES,
  WEEKDAY_KEYS,
  WEEKDAY_LABELS_ES,
  type PowerManagementPayload,
  type TableColumnConfig,
  type VmInventoryItem,
  type VmPowerAction,
  type VmPowerScheduleItem,
  type VmPowerState,
  type WeekdayKey,
} from "@/types/azurePowerManagement.types";

const VISIBLE_SCROLLBAR =
  "overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 " +
  "scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 " +
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 " +
  "dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 " +
  "dark:[&::-webkit-scrollbar-track]:bg-slate-800";

const CELL = "min-w-[120px] max-w-[240px] truncate";

const money = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Días ISO CSV para el backend (1=Lunes..7=Domingo). */
function daysToCsv(days: WeekdayKey[]): string | null {
  const ordered = WEEKDAY_KEYS.filter((d) => days.includes(d));
  if (ordered.length === 0 || ordered.length === 7) return null;
  return ordered.map((d) => WEEKDAY_KEYS.indexOf(d) + 1).join(",");
}

function describeFrequency(s: VmPowerScheduleItem): string {
  if (s.scheduleType === "ONE_TIME") {
    const d = s.scheduleDate;
    if (!d) return "Fecha puntual";
    const [y, m, day] = d.split("-");
    return `Puntual · ${day}/${m}/${y}`;
  }
  const days = s.daysOfWeek;
  if (days.length === 7) return "Todos los días";
  const isBusiness = days.length === 5 && BUSINESS_DAYS.every((d) => days.includes(d));
  if (isBusiness) return "Lunes a Viernes (L-V)";
  if (days.length === 2 && days.includes("Sat") && days.includes("Sun")) return "Fines de semana (S-D)";
  return days.map((d) => WEEKDAY_LABELS_ES[d].slice(0, 3)).join(", ");
}

function ActionBadge({ action }: { action: VmPowerAction }) {
  const style =
    action === "START"
      ? "border-blue-200 dark:border-blue-800 text-[#0078D4]"
      : action === "RESTART"
        ? "border-blue-300 dark:border-blue-700 text-blue-600"
        : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300";
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 whitespace-nowrap ${style}`}>
      {ACTION_LABELS_ES[action]}
    </span>
  );
}

function PowerStateBadge({ state }: { state: VmPowerState }) {
  if (state === "running") {
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 whitespace-nowrap">
        Encendida
      </span>
    );
  }
  if (state === "starting") {
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/30 text-[#0078D4] border border-blue-200 dark:border-blue-800 whitespace-nowrap">
        Iniciando…
      </span>
    );
  }
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 whitespace-nowrap">
      {state === "deallocated" ? "Apagada" : "Detenida"}
    </span>
  );
}

/** Menú de visibilidad de columnas con persistencia por tenant. */
function useColumnConfig(storageKey: string, defaults: TableColumnConfig[]) {
  const [columns, setColumns] = useState<TableColumnConfig[]>(defaults);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return;
      setColumns((prev) =>
        prev.map((c) => {
          const match = parsed.find((p: { id?: string }) => p?.id === c.id);
          return match ? { ...c, visible: Boolean(match.visible) } : c;
        })
      );
    } catch {
      // Preferencia corrupta: se ignora y se usan los defaults.
    }
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(columns.map((c) => ({ id: c.id, visible: c.visible }))));
    } catch {
      // Cuota llena o modo privado: la preferencia simplemente no persiste.
    }
  }, [columns, storageKey]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const isVisible = useCallback(
    (id: string) => columns.find((c) => c.id === id)?.visible ?? true,
    [columns]
  );
  const toggle = useCallback(
    (id: string) => setColumns((prev) => prev.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c))),
    []
  );

  return { columns, isVisible, toggle, open, setOpen, menuRef };
}

function ColumnMenu({
  columns,
  toggle,
  open,
  setOpen,
  menuRef,
}: ReturnType<typeof useColumnConfig>) {
  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap"
      >
        <IconColumns size={16} className="inline mr-1.5 text-[#0078D4]" stroke={1.5} />
        Personalizar Columnas
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-60 p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl z-[100] space-y-0.5">
          {columns.map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={c.visible}
                onChange={() => toggle(c.id)}
                className="accent-[#0054A6] cursor-pointer"
              />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function VmPowerManagementPanel() {
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || "";
  const searchParams = useSearchParams();
  const { instance, accounts } = useMsal();

  const isMock = useMemo(
    () =>
      isMockTenant(tenantId) ||
      searchParams.get("mock") === "true" ||
      tenantId.startsWith("demo-") ||
      tenantId.startsWith("mock-"),
    [tenantId, searchParams]
  );

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (isMock || accounts.length === 0) return {};
    try {
      const token = await getFreshIdToken(instance, accounts[0], ["User.Read"]);
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }, [instance, accounts, isMock]);

  // El fetcher no se dispara hasta tener identidad resuelta: sin esto el primer
  // render manda la request sin token y cosecha un 401 a los pocos ms.
  const canFetch = Boolean(tenantId) && (isMock || accounts.length > 0);
  const apiUrl = `/api/governance/power-management?tenantId=${encodeURIComponent(tenantId)}${isMock ? "&mock=true" : ""}`;

  const { data, error, isValidating, mutate } = useSWR<PowerManagementPayload>(
    canFetch ? apiUrl : null,
    async (url: string) => {
      const res = await fetch(url, { headers: await authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    { revalidateOnFocus: false, dedupingInterval: 20000 }
  );

  const summary = data?.summary;
  const schedules = useMemo(() => summary?.schedules || [], [summary]);
  const vms = useMemo(() => summary?.vms || [], [summary]);

  // ─── Formulario de programación ───
  const [scheduleMode, setScheduleMode] = useState<"ONE_TIME" | "RECURRING_WEEKLY">("RECURRING_WEEKLY");
  const [formVm, setFormVm] = useState("");
  const [vmSearch, setVmSearch] = useState("");
  const [formAction, setFormAction] = useState<VmPowerAction>("STOP_DEALLOCATE");
  const [formTime, setFormTime] = useState("19:00");
  const [formDate, setFormDate] = useState("");
  const [formDays, setFormDays] = useState<WeekdayKey[]>(BUSINESS_DAYS);
  const [formTz, setFormTz] = useState(DEFAULT_TIMEZONE);
  const [isSaving, setIsSaving] = useState(false);

  // ─── Smart Shutdown ───
  const [smartEnabled, setSmartEnabled] = useState(true);
  const [cpuThreshold, setCpuThreshold] = useState(DEFAULT_CPU_THRESHOLD_PERCENTAGE);
  const [showCalibrate, setShowCalibrate] = useState(false);
  const [draftThreshold, setDraftThreshold] = useState(DEFAULT_CPU_THRESHOLD_PERCENTAGE);

  // ─── Inventario ───
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [invSearch, setInvSearch] = useState("");
  const [invSub, setInvSub] = useState("ALL");
  const [invState, setInvState] = useState("ALL");
  const [invSort, setInvSort] = useState<"savings_desc" | "savings_asc" | "spend_desc" | "name_asc" | "name_desc">("savings_desc");
  const [pendingAction, setPendingAction] = useState<{ action: VmPowerAction; ids: string[] } | null>(null);
  /** Estado optimista: id de VM → estado mostrado mientras Azure procesa. */
  const [optimisticState, setOptimisticState] = useState<Record<string, VmPowerState>>({});

  const scheduleCols = useColumnConfig(`table_columns_config_power_schedules_${tenantId}`, SCHEDULE_COLUMNS);
  const inventoryCols = useColumnConfig(`table_columns_config_vm_inventory_${tenantId}`, INVENTORY_COLUMNS);

  const vmOptions = useMemo(() => {
    const q = vmSearch.trim().toLowerCase();
    return vms.filter((v) => !q || v.name.toLowerCase().includes(q) || v.resourceGroup.toLowerCase().includes(q));
  }, [vms, vmSearch]);

  const filteredVms = useMemo(() => {
    const q = invSearch.trim().toLowerCase();
    const list = vms.filter((v) => {
      if (q && !v.name.toLowerCase().includes(q) && !v.resourceGroup.toLowerCase().includes(q)) return false;
      if (invSub !== "ALL" && v.subscriptionId !== invSub) return false;
      const state = optimisticState[v.id] || v.powerState;
      if (invState === "RUNNING" && state !== "running") return false;
      if (invState === "STOPPED" && state === "running") return false;
      if (invState === "SCHEDULED" && !v.hasActiveSchedule) return false;
      if (invState === "UNSCHEDULED" && v.hasActiveSchedule) return false;
      return true;
    });
    return [...list].sort((a, b) => {
      if (invSort === "savings_desc") return b.offHoursPotentialSavingsUSD - a.offHoursPotentialSavingsUSD;
      if (invSort === "savings_asc") return a.offHoursPotentialSavingsUSD - b.offHoursPotentialSavingsUSD;
      if (invSort === "spend_desc") return b.monthlySpendUSD - a.monthlySpendUSD;
      if (invSort === "name_asc") return a.name.localeCompare(b.name);
      if (invSort === "name_desc") return b.name.localeCompare(a.name);
      return 0;
    });
  }, [vms, invSearch, invSub, invState, invSort, optimisticState]);

  const schedulePg = usePagination(schedules, 15);
  const inventoryPg = usePagination(filteredVms, 15);

  const toggleDay = (d: WeekdayKey) =>
    setFormDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  // ─── Guardar horario ───
  const handleSaveSchedule = async () => {
    const vm = vms.find((v) => v.id === formVm);
    if (!vm) {
      toast.error("Elegí una máquina virtual");
      return;
    }
    if (scheduleMode === "ONE_TIME" && !formDate) {
      toast.error("Elegí una fecha para el horario puntual");
      return;
    }
    if (scheduleMode === "RECURRING_WEEKLY" && formDays.length === 0) {
      toast.error("Elegí al menos un día de la semana");
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`/api/power/schedule${isMock ? "?mock=true" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          tenantId,
          subscriptionId: vm.subscriptionId,
          resourceGroup: vm.resourceGroup,
          vmName: vm.name,
          actionType: formAction === "START" ? "start" : formAction === "RESTART" ? "restart" : "shutdown",
          shutdownTime: formTime,
          // La ruta exige gmtOffset por compatibilidad; la zona IANA gana y es
          // la única que sobrevive al horario de verano.
          gmtOffset: "+00:00",
          timeZone: formTz,
          scheduleDate: scheduleMode === "ONE_TIME" ? formDate : null,
          daysOfWeek: scheduleMode === "RECURRING_WEEKLY" ? daysToCsv(formDays) : null,
          smartShutdownEnabled: formAction === "STOP_DEALLOCATE" && smartEnabled,
          maxCpuPercentage: cpuThreshold,
          idleDurationMinutes: 30,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "No se pudo guardar el horario");
      }
      const json = await res.json();
      toast.success(`Horario de ${ACTION_LABELS_ES[formAction].toLowerCase()} establecido para ${vm.name}`);
      setFormVm("");
      // Actualización optimista: la respuesta del POST ya trae la lista
      // completa y fresca desde la DB. No esperamos el re-fetch del endpoint
      // /api/governance/power-management (tiene caché de 300s en servidor) —
      // en su lugar inyectamos directamente los schedules nuevos en el SWR.
      if (json.schedules) {
        mutate(
          (prev) => prev ? { ...prev, summary: { ...prev.summary, schedules: json.schedules } } : prev,
          { revalidate: false }
        );
      } else {
        mutate();
      }
    } catch (e) {
      toast.error(errorMessage(e) || "Error al establecer el horario");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    try {
      const res = await fetch(
        `/api/power/schedule?tenantId=${encodeURIComponent(tenantId)}&id=${encodeURIComponent(id)}${isMock ? "&mock=true" : ""}`,
        { method: "DELETE", headers: await authHeaders() }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "No se pudo eliminar el horario");
      }
      const json = await res.json();
      toast.success("Horario eliminado");
      // Igual que en el guardado: usamos la lista fresca del DELETE en vez de
      // esperar que el caché del servidor caduque.
      if (json.schedules) {
        mutate(
          (prev) => prev ? { ...prev, summary: { ...prev.summary, schedules: json.schedules } } : prev,
          { revalidate: false }
        );
      } else {
        mutate();
      }
    } catch (e) {
      toast.error(errorMessage(e) || "Error al eliminar el horario");
    }
  };

  // ─── Acciones de energía ───
  const runPowerAction = async (action: VmPowerAction, ids: string[]) => {
    const targets = vms.filter((v) => ids.includes(v.id));
    if (targets.length === 0) return;

    // Optimistic UI: el badge cambia ya, mientras ARM procesa la operación
    // asíncrona. Si el POST falla se revierte y se revalida.
    const optimistic: VmPowerState = action === "START" ? "starting" : action === "RESTART" ? "starting" : "deallocated";
    setOptimisticState((prev) => {
      const next = { ...prev };
      for (const t of targets) next[t.id] = optimistic;
      return next;
    });

    try {
      const res = await fetch(`/api/power${isMock ? "?mock=true" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({
          tenantId,
          action: action === "START" ? "start" : action === "RESTART" ? "restart" : "stop",
          vms: targets.map((t) => ({
            subscriptionId: t.subscriptionId,
            resourceGroup: t.resourceGroup,
            resourceName: t.name,
          })),
          thresholdOptions:
            action === "STOP_DEALLOCATE" && smartEnabled
              ? { enabled: true, maxCpuPercentage: cpuThreshold, idleDurationMinutes: 30 }
              : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

      // Un 200 puede traer omisiones por umbral de CPU: esas VMs NO se apagaron
      // y su badge optimista tiene que volver atrás.
      const skipped: Array<{ vm: string; reason: string }> = body.skipped || [];
      if (skipped.length > 0) {
        setOptimisticState((prev) => {
          const next = { ...prev };
          for (const s of skipped) {
            const match = targets.find((t) => t.name === s.vm);
            if (match) delete next[match.id];
          }
          return next;
        });
        toast.warning(`${skipped.length} VM(s) omitidas — ${skipped[0].reason}`);
      }
      const succeeded = Number(body.succeeded ?? targets.length - skipped.length);
      if (succeeded > 0) toast.success(`Acción ${ACTION_LABELS_ES[action].toLowerCase()} enviada a ${succeeded} VM(s)`);
      if (Array.isArray(body.failed) && body.failed.length > 0) {
        toast.error(`${body.failed.length} con error — ${body.failed[0]?.error || ""}`);
      }
      setSelectedIds(new Set());
    } catch (e) {
      setOptimisticState((prev) => {
        const next = { ...prev };
        for (const t of targets) delete next[t.id];
        return next;
      });
      toast.error(errorMessage(e) || "Error al ejecutar la acción");
    } finally {
      // Azure tarda en reflejar el nuevo powerState; se revalida a los 15 s
      // para que el badge optimista ceda ante el estado real.
      setTimeout(() => {
        setOptimisticState({});
        mutate();
      }, 15000);
    }
  };

  const stateOf = (vm: VmInventoryItem): VmPowerState => optimisticState[vm.id] || vm.powerState;

  const kpis = [
    {
      label: "Ahorro Mensual Off-Hours",
      tip: "Gasto mensual que ya se recupera gracias a los horarios activos. Se calcula con la ventana real de cada VM (apagado → próximo encendido), no con una constante: un fin de semana sin encendido programado arrastra el apagado del viernes hasta el lunes.",
      value: money(summary?.totalOffHoursSavingsMonthlyUSD || 0),
      sub: `${money(summary?.untappedSavingsMonthlyUSD || 0)} adicionales disponibles`,
      Icon: IconCash,
      color: "text-[#0078D4]",
    },
    {
      label: "VMs con Schedule Activo",
      tip: "Máquinas con al menos una regla de encendido o apagado programada.",
      value: `${summary?.activeSchedulesCount || 0}`,
      sub: `${schedules.length} regla(s) en total`,
      Icon: IconCalendarTime,
      color: "text-[#2563EB]",
    },
    {
      label: "VMs Encendidas en Vivo",
      tip: "Instancias en estado running según Azure Resource Graph.",
      value: `${summary?.runningVmsCount || 0}`,
      sub: `${summary?.deallocatedVmsCount || 0} apagada(s)`,
      Icon: IconPlayerPlay,
      color: "text-[#0284C7]",
    },
    {
      label: "Horas de Cómputo Ahorradas",
      tip: "Horas mensuales de cómputo no facturadas por los horarios activos (horas apagada por semana × 4,33).",
      value: `${(summary?.totalMonthlyAvoidedHours || 0).toLocaleString("es-AR")} h`,
      sub: `${summary?.smartShutdownAvoidedOutagesCount || 0} apagado(s) pospuesto(s) por CPU`,
      Icon: IconClockCheck,
      color: "text-slate-900 dark:text-white",
    },
  ];

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado ─── */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pt-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconServer size={22} className="text-[#0078D4]" stroke={1.5} />
              <span>Control de Máquinas Virtuales y Horarios de Apagado</span>
            </h1>
            <InfoTooltip
              content="Automatiza el encendido y apagado de VMs por horario y zona horaria. Smart Shutdown consulta la CPU real de los últimos 30 minutos antes de apagar, así una VM ocupada no se cae en medio de un proceso."
              position="bottom"
              align="left"
            />
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? "Producción Live" : "Entorno Demo"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Apagado programado con guard de telemetría, zonas horarias IANA y proyección de ahorro fuera de horario
          </p>
        </div>
        <button
          onClick={() => mutate()}
          disabled={isValidating}
          className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
        >
          <IconRotateClockwise size={16} className={`text-[#0078D4] ${isValidating ? "animate-spin" : ""}`} stroke={1.5} />
          Actualizar
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 flex items-start gap-2">
          <IconAlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" stroke={1.5} />
          <p className="text-xs text-red-700 dark:text-red-400">{String(error.message || error)}</p>
        </div>
      )}

      {/* ─── KPIs ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between"
          >
            <div className="space-y-1 min-w-0">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <span>{k.label}</span>
                <InfoTooltip content={k.tip} />
              </div>
              <div className={`text-2xl font-extrabold truncate ${k.color}`} title={k.value}>
                {k.value}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{k.sub}</div>
            </div>
            <k.Icon size={32} className="text-[#0078D4] shrink-0" stroke={1.5} />
          </div>
        ))}
      </div>

      {/* ─── Sección 1: Programador ─── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800 px-4 pt-3">
          {(["ONE_TIME", "RECURRING_WEEKLY"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setScheduleMode(mode)}
              className={`px-3.5 py-2 text-xs font-semibold rounded-t-lg border-b-2 cursor-pointer transition ${
                scheduleMode === mode
                  ? "border-[#0078D4] text-[#0054A6]"
                  : "border-transparent text-slate-500 dark:text-slate-400"
              }`}
            >
              {mode === "ONE_TIME" ? "Hora única" : "Recurrente (días + rango)"}
            </button>
          ))}
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
              Programador de Encendido y Apagado
            </h2>
            <InfoTooltip content="El horario se guarda con su zona IANA, no con un offset fijo: así sigue disparando a la hora local correcta cuando cambia el horario de verano. El patrón 'desde–hasta' se modela como dos reglas (una de encendido y otra de apagado) sobre los mismos días." />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Nombre de la Máquina</label>
              <div className="relative">
                <IconSearch size={14} className="text-slate-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="Buscar VM..."
                  value={vmSearch}
                  onChange={(e) => setVmSearch(e.target.value)}
                  className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
                />
              </div>
              <select
                value={formVm}
                onChange={(e) => setFormVm(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
              >
                <option value="">Seleccionar máquina virtual…</option>
                {vmOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v.resourceGroup}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Acción</label>
              <select
                value={formAction}
                onChange={(e) => setFormAction(e.target.value as VmPowerAction)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
              >
                <option value="STOP_DEALLOCATE">Apagar (Deallocate)</option>
                <option value="START">Encender</option>
                <option value="RESTART">Reiniciar</option>
              </select>
              {formAction === "STOP_DEALLOCATE" && (
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  Deallocate libera el cómputo y detiene el cargo; el disco se sigue facturando.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 flex items-center gap-1">
                <IconClock size={13} className="text-[#0078D4]" stroke={1.5} />
                Hora
              </label>
              <input
                type="time"
                value={formTime}
                onChange={(e) => setFormTime(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
              />
              {scheduleMode === "ONE_TIME" && (
                <input
                  type="date"
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
                />
              )}
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Zona Horaria</label>
              <select
                value={formTz}
                onChange={(e) => setFormTz(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
              >
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {scheduleMode === "RECURRING_WEEKLY" && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Días:</span>
              {WEEKDAY_KEYS.map((d) => (
                <button
                  key={d}
                  onClick={() => toggleDay(d)}
                  title={WEEKDAY_LABELS_ES[d]}
                  className={`w-8 h-8 text-xs font-bold rounded-lg border cursor-pointer transition ${
                    formDays.includes(d)
                      ? "border-[#0078D4] text-[#0054A6] bg-blue-50/60 dark:bg-blue-950/30"
                      : "border-slate-300 dark:border-slate-700 text-slate-500 bg-white dark:bg-slate-900"
                  }`}
                >
                  {WEEKDAY_INITIALS_ES[d]}
                </button>
              ))}
              <button
                onClick={() => setFormDays(BUSINESS_DAYS)}
                className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] cursor-pointer"
              >
                Días Laborales L-V
              </button>
              <button
                onClick={() => setFormDays([...WEEKDAY_KEYS])}
                className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Todos
              </button>
            </div>
          )}

          <button
            onClick={handleSaveSchedule}
            disabled={isSaving || !formVm}
            className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer disabled:opacity-50"
          >
            <IconPlus size={16} className="inline mr-1" stroke={2} />
            Establecer Horario
          </button>
        </div>
      </div>

      {/* ─── Sección 2: Horarios programados ─── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
            Horarios Programados
            <InfoTooltip content="Cada fila es una regla independiente. Una VM con apagado y encendido en los mismos días queda apagada en la ventana entre ambos; si el fin de semana no tiene encendido, el apagado del viernes se extiende hasta el lunes." />
          </h2>
          <ColumnMenu {...scheduleCols} />
        </div>

        <div className={VISIBLE_SCROLLBAR}>
          <table className="w-full text-xs table-fixed">
            <thead className="bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
              <tr>
                {SCHEDULE_COLUMNS.filter((c) => scheduleCols.isVisible(c.id)).map((c) => (
                  <ResizableTh
                    key={c.id}
                    minWidth={c.minWidth}
                    className="py-2.5 px-3 font-semibold text-left text-[#1B2A41] dark:text-slate-200"
                  >
                    {c.label}
                  </ResizableTh>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {schedulePg.paged.length === 0 ? (
                <tr>
                  <td colSpan={SCHEDULE_COLUMNS.length} className="py-8 text-center text-slate-500 dark:text-slate-400">
                    No hay horarios programados. Usá el formulario de arriba para crear el primero.
                  </td>
                </tr>
              ) : (
                schedulePg.paged.map((s: VmPowerScheduleItem) => (
                  <tr key={s.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    {scheduleCols.isVisible("vm") && (
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <IconServer size={15} className="text-[#0078D4] shrink-0" stroke={1.5} />
                          <span className={`font-semibold text-[#1B2A41] dark:text-slate-100 ${CELL}`} title={s.vmName}>
                            {s.vmName}
                          </span>
                        </div>
                        <span className="block text-[10px] text-slate-500 dark:text-slate-400 truncate" title={s.subscriptionName}>
                          {s.resourceGroup} · {s.subscriptionName}
                        </span>
                      </td>
                    )}
                    {scheduleCols.isVisible("action") && (
                      <td className="py-2.5 px-3">
                        <ActionBadge action={s.action} />
                      </td>
                    )}
                    {scheduleCols.isVisible("time") && (
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-900 dark:text-white">{s.time}</td>
                    )}
                    {scheduleCols.isVisible("frequency") && (
                      <td className={`py-2.5 px-3 text-slate-600 dark:text-slate-300 ${CELL}`} title={describeFrequency(s)}>
                        {describeFrequency(s)}
                      </td>
                    )}
                    {scheduleCols.isVisible("timezone") && (
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap" title={s.timezone}>
                        {s.timezoneLabel}
                      </td>
                    )}
                    {scheduleCols.isVisible("smart") && (
                      <td className="py-2.5 px-3">
                        {s.action !== "STOP_DEALLOCATE" ? (
                          <span className="text-[10px] text-slate-400">No aplica</span>
                        ) : s.smartShutdownEnabled ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0078D4] whitespace-nowrap">
                            Activo (&lt; {s.cpuThresholdPercentage}% CPU)
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400">
                            Desactivado
                          </span>
                        )}
                      </td>
                    )}
                    {scheduleCols.isVisible("lastRun") && (
                      <td className="py-2.5 px-3">
                        {s.lastExecutionDate && s.lastExecutionStatus ? (
                          <span
                            className="flex items-center gap-1 text-slate-600 dark:text-slate-300"
                            title={s.lastExecutionError || undefined}
                          >
                            {s.lastExecutionStatus === "SUCCESS" ? (
                              <IconCircleCheck size={14} className="text-emerald-600 shrink-0" stroke={1.5} />
                            ) : s.lastExecutionStatus === "SKIPPED_BUSY" ? (
                              <IconCpu size={14} className="text-[#0078D4] shrink-0" stroke={1.5} />
                            ) : (
                              <IconCircleX size={14} className="text-rose-600 shrink-0" stroke={1.5} />
                            )}
                            <span className="truncate">
                              {s.lastExecutionDate} — {EXECUTION_STATUS_LABELS_ES[s.lastExecutionStatus]}
                            </span>
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">Sin ejecuciones</span>
                        )}
                      </td>
                    )}
                    {scheduleCols.isVisible("actions") && (
                      <td className="py-2.5 px-3">
                        <button
                          onClick={() => handleDeleteSchedule(s.id)}
                          title="Eliminar horario"
                          className="cursor-pointer bg-transparent"
                        >
                          <IconTrash size={16} className="text-slate-400 hover:text-rose-600" stroke={1.5} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={schedulePg.page}
          totalPages={schedulePg.totalPages}
          pageSize={schedulePg.pageSize}
          total={schedulePg.total}
          setPage={schedulePg.setPage}
          setPageSize={schedulePg.setPageSize}
          pageSizes={[15, 30, 45, 60]}
        />
      </div>

      {/* ─── Sección 3: Banner Smart Shutdown ─── */}
      <div className="bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 rounded-xl">
        <div className="flex items-start gap-2.5 min-w-0">
          <IconCpu size={20} className="text-[#0078D4] shrink-0 mt-0.5" stroke={1.5} />
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            <strong className="text-[#1B2A41] dark:text-slate-100">Smart Shutdown Inteligente:</strong> evalúa la
            métrica de CPU de los últimos 30 minutos antes de apagar. Si la VM registra uso activo
            (&gt; {cpuThreshold}%), pospone el apagado hasta el próximo ciclo y lo registra como omitido.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setSmartEnabled(!smartEnabled)}
            role="switch"
            aria-checked={smartEnabled}
            className={`relative w-11 h-6 rounded-full transition cursor-pointer ${
              smartEnabled ? "bg-[#0078D4]" : "bg-slate-300 dark:bg-slate-700"
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
                smartEnabled ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 w-16">
            {smartEnabled ? "Enabled" : "Disabled"}
          </span>
          <button
            onClick={() => {
              setDraftThreshold(cpuThreshold);
              setShowCalibrate(true);
            }}
            className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] cursor-pointer whitespace-nowrap"
          >
            <IconAdjustments size={16} className="inline mr-1 text-[#0078D4]" stroke={1.5} />
            Calibrar Umbral
          </button>
        </div>
      </div>

      {/* ─── Sección 4: Inventario en vivo ─── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
            Control de Máquinas Virtuales en Vivo
            <InfoTooltip content="Estado y consumo actuales según Azure Resource Graph y Azure Monitor. El CPU se consulta sólo para las VMs encendidas: una desasignada no emite métricas, y un 0% ahí se leería como 'ociosa'." />
          </h2>
          <ColumnMenu {...inventoryCols} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <IconSearch size={14} className="text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="Buscar VM o grupo de recursos..."
              value={invSearch}
              onChange={(e) => setInvSearch(e.target.value)}
              className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            />
          </div>
          <select
            value={invSub}
            onChange={(e) => setInvSub(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">Todas las Suscripciones</option>
            {(data?.availableSubscriptions || []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            value={invState}
            onChange={(e) => setInvState(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">Todos los Estados</option>
            <option value="RUNNING">Encendidas</option>
            <option value="STOPPED">Apagadas</option>
            <option value="SCHEDULED">Con horario</option>
            <option value="UNSCHEDULED">Sin horario</option>
          </select>
          <select
            value={invSort}
            onChange={(e) => setInvSort(e.target.value as typeof invSort)}
            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="savings_desc">Ahorro: Mayor a Menor</option>
            <option value="savings_asc">Ahorro: Menor a Mayor</option>
            <option value="spend_desc">Gasto: Mayor a Menor</option>
            <option value="name_asc">Nombre: A-Z</option>
            <option value="name_desc">Nombre: Z-A</option>
          </select>
        </div>

        {/* Barra de acciones masivas */}
        {selectedIds.size > 0 && (
          <div className="p-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-xs font-semibold text-[#1B2A41] dark:text-slate-100">
              {selectedIds.size} máquina(s) seleccionada(s)
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setPendingAction({ action: "STOP_DEALLOCATE", ids: Array.from(selectedIds) })}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer"
              >
                <IconPower size={16} className="inline mr-1.5" stroke={2} />
                Apagar Selección
              </button>
              <button
                onClick={() => runPowerAction("START", Array.from(selectedIds))}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition cursor-pointer"
              >
                <IconPlayerPlay size={16} className="inline mr-1.5" stroke={2} />
                Encender Selección
              </button>
              <button
                onClick={() => setPendingAction({ action: "RESTART", ids: Array.from(selectedIds) })}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-700 text-white hover:bg-slate-800 transition cursor-pointer"
              >
                <IconRotateClockwise size={16} className="inline mr-1.5" stroke={2} />
                Reiniciar Selección
              </button>
            </div>
          </div>
        )}

        <div className={VISIBLE_SCROLLBAR}>
          <table className="w-full text-xs table-fixed">
            <thead className="bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-2.5 px-3 w-10">
                  <input
                    type="checkbox"
                    className="accent-[#0054A6] cursor-pointer"
                    checked={inventoryPg.paged.length > 0 && inventoryPg.paged.every((v: VmInventoryItem) => selectedIds.has(v.id))}
                    onChange={(e) => {
                      const next = new Set(selectedIds);
                      for (const v of inventoryPg.paged as VmInventoryItem[]) {
                        if (e.target.checked) next.add(v.id);
                        else next.delete(v.id);
                      }
                      setSelectedIds(next);
                    }}
                  />
                </th>
                {INVENTORY_COLUMNS.filter((c) => inventoryCols.isVisible(c.id)).map((c) => (
                  <ResizableTh
                    key={c.id}
                    minWidth={c.minWidth}
                    className="py-2.5 px-3 font-semibold text-left text-[#1B2A41] dark:text-slate-200"
                  >
                    {c.label}
                  </ResizableTh>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {inventoryPg.paged.length === 0 ? (
                <tr>
                  <td colSpan={INVENTORY_COLUMNS.length + 1} className="py-8 text-center text-slate-500 dark:text-slate-400">
                    {vms.length === 0
                      ? "Azure no reporta máquinas virtuales en las suscripciones visibles."
                      : "Ninguna máquina coincide con los filtros aplicados."}
                  </td>
                </tr>
              ) : (
                inventoryPg.paged.map((vm: VmInventoryItem) => {
                  const state = stateOf(vm);
                  return (
                    <tr key={vm.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-3">
                        <input
                          type="checkbox"
                          className="accent-[#0054A6] cursor-pointer"
                          checked={selectedIds.has(vm.id)}
                          onChange={(e) => {
                            const next = new Set(selectedIds);
                            if (e.target.checked) next.add(vm.id);
                            else next.delete(vm.id);
                            setSelectedIds(next);
                          }}
                        />
                      </td>
                      {inventoryCols.isVisible("vm") && (
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <IconDeviceDesktopAnalytics size={15} className="text-[#0078D4] shrink-0" stroke={1.5} />
                            <span className={`font-semibold text-[#1B2A41] dark:text-slate-100 ${CELL}`} title={vm.name}>
                              {vm.name}
                            </span>
                          </div>
                          {vm.hasActiveSchedule && (
                            <span className="text-[10px] text-[#0054A6]">
                              {vm.scheduledOffHoursPerWeek > 0
                                ? `${vm.scheduledOffHoursPerWeek} h/sem apagada`
                                : "Con horario"}
                            </span>
                          )}
                        </td>
                      )}
                      {inventoryCols.isVisible("subscription") && (
                        <td className={`py-2.5 px-3 text-slate-600 dark:text-slate-300 ${CELL}`} title={vm.subscriptionName}>
                          {vm.subscriptionName}
                        </td>
                      )}
                      {inventoryCols.isVisible("resourceGroup") && (
                        <td className={`py-2.5 px-3 text-slate-600 dark:text-slate-300 ${CELL}`} title={vm.resourceGroup}>
                          {vm.resourceGroup}
                        </td>
                      )}
                      {inventoryCols.isVisible("region") && (
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">{vm.location}</td>
                      )}
                      {inventoryCols.isVisible("size") && (
                        <td className={`py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300 ${CELL}`} title={vm.vmSize}>
                          {vm.vmSize}
                        </td>
                      )}
                      {inventoryCols.isVisible("cpu") && (
                        <td className="py-2.5 px-3">
                          {vm.currentCpuPercentage < 0 ? (
                            <span className="text-[10px] text-slate-400" title="Azure Monitor no devolvió métricas para esta VM">
                              s/d
                            </span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden min-w-[50px]">
                                <div
                                  className="h-full rounded-full bg-[#0078D4]"
                                  style={{ width: `${Math.min(100, vm.currentCpuPercentage)}%` }}
                                />
                              </div>
                              <span className="text-slate-700 dark:text-slate-300 font-semibold tabular-nums whitespace-nowrap">
                                {vm.currentCpuPercentage.toFixed(1)}%
                              </span>
                            </div>
                          )}
                        </td>
                      )}
                      {inventoryCols.isVisible("spend") && (
                        <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white tabular-nums whitespace-nowrap">
                          {money(vm.monthlySpendUSD)}
                        </td>
                      )}
                      {inventoryCols.isVisible("savings") && (
                        <td className="py-2.5 px-3 font-semibold text-[#0078D4] tabular-nums whitespace-nowrap">
                          {money(vm.offHoursPotentialSavingsUSD)}
                        </td>
                      )}
                      {inventoryCols.isVisible("state") && (
                        <td className="py-2.5 px-3">
                          <PowerStateBadge state={state} />
                        </td>
                      )}
                      {inventoryCols.isVisible("actions") && (
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button
                              onClick={() => runPowerAction("START", [vm.id])}
                              disabled={state === "running"}
                              className="px-2 py-1 text-[10px] font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                            >
                              <IconPlayerPlay size={14} className="inline mr-1" stroke={2} />
                              Start
                            </button>
                            <button
                              onClick={() => setPendingAction({ action: "STOP_DEALLOCATE", ids: [vm.id] })}
                              disabled={state !== "running"}
                              className="px-2 py-1 text-[10px] font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                            >
                              <IconPower size={14} className="inline mr-1" stroke={2} />
                              Stop
                            </button>
                            <button
                              onClick={() => setPendingAction({ action: "RESTART", ids: [vm.id] })}
                              disabled={state !== "running"}
                              className="px-2 py-1 text-[10px] font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                            >
                              <IconRotateClockwise size={14} className="inline mr-1" stroke={2} />
                              Restart
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={inventoryPg.page}
          totalPages={inventoryPg.totalPages}
          pageSize={inventoryPg.pageSize}
          total={inventoryPg.total}
          setPage={inventoryPg.setPage}
          setPageSize={inventoryPg.setPageSize}
          pageSizes={[15, 30, 45, 60]}
        />
      </div>

      <div className="flex justify-end">
        <span className="text-[10px] text-slate-400 flex items-center gap-1">
          <IconSparkles size={14} className="text-[#0078D4]" stroke={1.5} />
          Fuente: Azure Resource Graph + Azure Monitor · ejecución vía cron cada pocos minutos
        </span>
      </div>

      {/* ─── Modal: confirmación de apagado / reinicio ─── */}
      {pendingAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[100]">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
                {pendingAction.action === "RESTART" ? (
                  <IconRotateClockwise size={18} className="text-[#0078D4]" stroke={1.5} />
                ) : (
                  <IconPower size={18} className="text-[#0078D4]" stroke={1.5} />
                )}
                Confirmar {ACTION_LABELS_ES[pendingAction.action].toLowerCase()}
              </h3>
              <button onClick={() => setPendingAction(null)} className="cursor-pointer bg-transparent">
                <IconX size={18} className="text-slate-400" stroke={1.5} />
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Se va a {ACTION_LABELS_ES[pendingAction.action].toLowerCase()} {pendingAction.ids.length} máquina(s)
              virtual(es).
              {pendingAction.action === "STOP_DEALLOCATE" && smartEnabled && (
                <>
                  {" "}
                  Smart Shutdown está activo: las que registren más de {cpuThreshold}% de CPU en los últimos 30 minutos
                  se van a omitir y quedarán encendidas.
                </>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPendingAction(null)}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const p = pendingAction;
                  setPendingAction(null);
                  runPowerAction(p.action, p.ids);
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer"
              >
                <IconCheck size={16} className="inline mr-1" stroke={2} />
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Drawer: calibración del umbral ─── */}
      {showCalibrate && (
        <div className="fixed inset-0 bg-black/50 flex justify-end z-[100]">
          <div className="w-full max-w-sm h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 shadow-2xl p-5 space-y-5 overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
                <IconAdjustments size={18} className="text-[#0078D4]" stroke={1.5} />
                Calibrar Umbral de CPU
              </h3>
              <button onClick={() => setShowCalibrate(false)} className="cursor-pointer bg-transparent">
                <IconX size={18} className="text-slate-400" stroke={1.5} />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Umbral por debajo del cual se considera que la VM está ociosa y se puede apagar. Un valor muy alto apaga
              máquinas con trabajo en curso; uno muy bajo hace que el ruido de fondo del sistema operativo cancele todos
              los apagados y el ahorro nunca se materialice.
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Umbral de CPU</label>
                <span className="text-lg font-extrabold text-[#0078D4] tabular-nums">{draftThreshold}%</span>
              </div>
              <input
                type="range"
                min={1}
                max={50}
                value={draftThreshold}
                onChange={(e) => setDraftThreshold(Number(e.target.value))}
                className="w-full accent-[#0054A6] cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>1% (muy conservador)</span>
                <span>50% (agresivo)</span>
              </div>
            </div>

            <div className="p-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/30">
              <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
                El umbral se aplica a los horarios que crees a partir de ahora y a las acciones masivas de esta pantalla.
                Los horarios ya guardados conservan el suyo hasta que los vuelvas a editar.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCalibrate(false)}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setCpuThreshold(draftThreshold);
                  setShowCalibrate(false);
                  toast.success(`Umbral de Smart Shutdown fijado en ${draftThreshold}%`);
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer"
              >
                <IconCheck size={16} className="inline mr-1" stroke={2} />
                Aplicar Umbral
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
