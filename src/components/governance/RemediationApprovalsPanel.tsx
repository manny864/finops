"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useMsal } from "@azure/msal-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import {
  IconGitPullRequest,
  IconClock,
  IconCircleCheck,
  IconCash,
  IconSparkles,
  IconChecklist,
  IconTrash,
  IconArrowsDown,
  IconSnowflake,
  IconPower,
  IconAlertTriangle,
  IconCheck,
  IconX,
  IconColumns,
  IconEye,
  IconRotateClockwise,
  IconInfoCircle,
  IconCamera,
} from "@tabler/icons-react";
import { useTenant } from "@/components/TenantProvider";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { errorMessage } from "@/lib/apiErrors";
import ResizableTh from "@/components/ResizableTh";
import Pagination, { usePagination } from "@/components/Pagination";
import InfoTooltip from "@/components/InfoTooltip";
import {
  HISTORY_COLUMNS,
  type ApprovalActionType,
  type ApprovalHistoryItem,
  type ApprovalStatus,
  type ApprovalsPayload,
  type PendingApprovalItem,
  type TableColumnConfig,
} from "@/types/azureRemediationApprovals.types";

const VISIBLE_SCROLLBAR =
  "overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 " +
  "scrollbar-track-slate-100 dark:scrollbar-track-slate-800 [&::-webkit-scrollbar]:h-2.5 " +
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 " +
  "dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-track]:bg-slate-100 " +
  "dark:[&::-webkit-scrollbar-track]:bg-slate-800";

const CELL = "min-w-[120px] max-w-[240px] truncate";

const money = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Fecha y hora con el formato del locale activo; antes era dd/mm/aaaa fijo. */
function useDateTime() {
  const locale = useLocale();
  return (iso: string) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };
}

const ACTION_ICONS: Record<ApprovalActionType, React.ComponentType<{ size?: number; className?: string; stroke?: number }>> = {
  DELETE_RESOURCE: IconTrash,
  RIGHTSIZE_VM: IconArrowsDown,
  CHANGE_TIER: IconSnowflake,
  POWER_OFF: IconPower,
  PURGE_BACKUP: IconTrash,
};

const STATUS_BADGE: Record<ApprovalStatus, string> = {
  APPROVED: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800",
  REJECTED: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700",
  FAILED: "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800",
  PENDING: "bg-blue-50 dark:bg-blue-950/30 text-[#0078D4] border border-blue-200 dark:border-blue-800",
};

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
          const m = parsed.find((p: { id?: string }) => p?.id === c.id);
          return m ? { ...c, visible: Boolean(m.visible) } : c;
        })
      );
    } catch {
      // Preferencia corrupta: se ignora.
    }
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(columns.map((c) => ({ id: c.id, visible: c.visible }))));
    } catch {
      // Cuota llena o modo privado.
    }
  }, [columns, storageKey]);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const isVisible = useCallback((id: string) => columns.find((c) => c.id === id)?.visible ?? true, [columns]);
  const toggle = useCallback(
    (id: string) => setColumns((p) => p.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c))),
    []
  );
  return { columns, isVisible, toggle, open, setOpen, menuRef };
}

function ColumnMenu({ columns, toggle, open, setOpen, menuRef }: ReturnType<typeof useColumnConfig>) {
  const t = useTranslations("RemediationApprovals");
  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap"
      >
        <IconColumns size={16} className="inline mr-1.5 text-[#0078D4]" stroke={1.5} />
        {t("customizeColumns")}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-60 p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl z-[100] space-y-0.5">
          {columns.map((c) => (
            <label
              key={c.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <input type="checkbox" checked={c.visible} onChange={() => toggle(c.id)} className="accent-[#0054A6] cursor-pointer" />
              {t(`col_${c.id}`)}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RemediationApprovalsPanel() {
  const t = useTranslations("RemediationApprovals");
  const dateTime = useDateTime();
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

  const canFetch = Boolean(tenantId) && (isMock || accounts.length > 0);
  const apiUrl = `/api/governance/approvals?tenantId=${encodeURIComponent(tenantId)}${isMock ? "&mock=true" : ""}`;

  const { data, error, isValidating, mutate } = useSWR<ApprovalsPayload>(
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
  const pending = useMemo(() => summary?.pendingRequests || [], [summary]);
  const history = useMemo(() => summary?.history || [], [summary]);

  /** Ids removidos de forma optimista mientras el backend resuelve. */
  const [resolving, setResolving] = useState<Set<string>>(new Set());
  const [approveTarget, setApproveTarget] = useState<PendingApprovalItem | null>(null);
  const [withSnapshot, setWithSnapshot] = useState(true);
  const [rejectTarget, setRejectTarget] = useState<PendingApprovalItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [detailItem, setDetailItem] = useState<ApprovalHistoryItem | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const cols = useColumnConfig(`table_columns_config_approvals_history_${tenantId}`, HISTORY_COLUMNS);

  const visiblePending = useMemo(() => pending.filter((p) => !resolving.has(p.id)), [pending, resolving]);
  const historyPg = usePagination(history, 15);

  const resolve = async (item: PendingApprovalItem, decision: "APPROVE" | "REJECT", extras: Record<string, unknown> = {}) => {
    // Optimista: la tarjeta desaparece ya. Si el backend falla se restaura.
    setResolving((prev) => new Set(prev).add(item.id));
    setIsBusy(true);
    try {
      const res = await fetch(`/api/governance/approvals${isMock ? "?mock=true" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ tenantId, approvalId: item.id, decision, ...extras }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

      if (decision === "APPROVE" && body.armExecutionStatus === "Failed") {
        // La petición se resolvió, pero Azure rechazó el cambio: no es un
        // éxito y la tarjeta no debe volver, queda en el historial como fallida.
        toast.error(t("azureRejected", { message: body.message }));
      } else {
        toast.success(body.message || (decision === "APPROVE" ? t("actionExecuted") : t("requestRejected")));
      }
      mutate();
    } catch (e) {
      setResolving((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      toast.error(errorMessage(e) || t("resolveFailed"));
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * "Aprobar todo lo seguro" sólo alcanza a lo no destructivo y sin reinicio:
   * borrar un disco o redimensionar una VM productiva exige una decisión
   * consciente, no un clic masivo.
   */
  const safeItems = useMemo(
    () => visiblePending.filter((p) => !p.isDestructive && !p.requiresReboot),
    [visiblePending]
  );

  const handleApproveAllSafe = async () => {
    if (safeItems.length === 0) return;
    if (!confirm(t("confirmApproveAllSafe", { count: safeItems.length }))) {
      return;
    }
    // Secuencial: cada ejecución toca Azure y hay que poder decir cuál falló.
    for (const item of safeItems) {
      await resolve(item, "APPROVE");
    }
  };

  const kpis = [
    {
      label: t("kpiPendingLabel"),
      tip: t("kpiPendingTip"),
      value: String(visiblePending.length),
      Icon: IconClock,
      color: "text-[#0078D4]",
    },
    {
      label: t("kpiApprovedLabel"),
      tip: t("kpiApprovedTip"),
      value: String(summary?.approvedCount ?? 0),
      Icon: IconCircleCheck,
      color: "text-[#2563EB]",
    },
    {
      label: t("kpiReleasedLabel"),
      tip: t("kpiReleasedTip"),
      value: money(summary?.liberatedSavingsMonthlyUSD ?? 0),
      Icon: IconCash,
      color: "text-[#0284C7]",
    },
    {
      label: t("kpiWaitingLabel"),
      tip: t("kpiWaitingTip"),
      value: money(summary?.pendingSavingsMonthlyUSD ?? 0),
      Icon: IconSparkles,
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
              <IconGitPullRequest size={22} className="text-[#0078D4]" stroke={1.5} />
              <span>{t("pageTitle")}</span>
            </h1>
            <InfoTooltip
              content={t("pageTooltip")}
              position="bottom"
              align="left"
            />
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? t("sourceLive") : t("sourceDemo")}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t("pageSubtitle")}
          </p>
        </div>
        <button
          onClick={() => mutate()}
          disabled={isValidating}
          className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 cursor-pointer disabled:opacity-60"
        >
          <IconRotateClockwise size={16} className={`inline text-[#0078D4] ${isValidating ? "animate-spin" : ""}`} stroke={1.5} />
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
                <span className="truncate">{k.label}</span>
                <InfoTooltip content={k.tip} />
              </div>
              <div className={`text-2xl font-extrabold tabular-nums truncate ${k.color}`}>{k.value}</div>
            </div>
            <k.Icon size={32} className="text-[#0078D4] shrink-0" stroke={1.5} />
          </div>
        ))}
      </div>

      {/* ─── Sección 1: pendientes ─── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
            <IconGitPullRequest size={18} className="text-[#0078D4]" stroke={1.5} />
            {t("pendingHeading")}
            <InfoTooltip content={t("pendingTooltip")} />
          </h2>
          <button
            onClick={handleApproveAllSafe}
            disabled={safeItems.length === 0 || isBusy}
            title={
              safeItems.length === 0
                ? t("noSafeActions")
                : undefined
            }
            className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            <IconChecklist size={16} className="inline mr-1 text-[#0078D4]" stroke={1.5} />
            {t("approveAllSafe", { count: safeItems.length })}
          </button>
        </div>

        {visiblePending.length === 0 ? (
          <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center">
            <IconCircleCheck size={28} className="text-[#0078D4] mx-auto mb-2" stroke={1.5} />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t("emptyPending")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {visiblePending.map((p) => {
              const Icon = ACTION_ICONS[p.actionType];
              return (
                <div
                  key={p.id}
                  className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2 min-w-0">
                      <Icon size={18} className="text-[#0078D4] shrink-0 mt-0.5" stroke={1.5} />
                      <div className="min-w-0">
                        <h3 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 break-words">
                          {p.resourceName}
                          {p.targetConfiguration && (
                            <span className="font-normal text-slate-500 dark:text-slate-400">
                              {" "}
                              → {p.targetConfiguration}
                            </span>
                          )}
                        </h3>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {p.resourceTypeDisplay} · {p.resourceGroup} · {p.subscriptionName}
                        </span>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-blue-600 whitespace-nowrap shrink-0">
                      {p.actionType}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    {p.descriptionKey ? t(p.descriptionKey) : p.description || t(`action_${p.actionType}`)}
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    {t.rich("requestedBy", { who: p.requestedBy, b: (c) => <span className="font-semibold">{c}</span> })} · {dateTime(p.requestedAt)}
                  </p>

                  {p.requiresReboot && (
                    <p className="text-[11px] text-slate-700 dark:text-slate-300">
                      <IconAlertTriangle size={14} className="inline text-amber-600 mr-1" stroke={1.5} />
                      {t("rebootWarning")}
                    </p>
                  )}
                  {p.isDestructive && (
                    <p className="text-[11px] text-slate-700 dark:text-slate-300">
                      <IconAlertTriangle size={14} className="inline text-amber-600 mr-1" stroke={1.5} />
                      {t("irreversibleAction")}
                      {p.canSnapshot ? ` ${t("snapshotAvailable")}` : ` ${t("snapshotUnavailable")}`}
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 flex-wrap">
                    <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums whitespace-nowrap">
                      −{money(p.monthlySavingsUSD)} / mes
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setApproveTarget(p);
                          setWithSnapshot(p.canSnapshot);
                        }}
                        disabled={isBusy}
                        className="px-3 py-1.5 text-xs font-medium rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer disabled:opacity-50"
                      >
                        <IconCheck size={16} className="inline mr-1.5" stroke={2} />
                        {t("approveAndRun")}
                      </button>
                      <button
                        onClick={() => {
                          setRejectTarget(p);
                          setRejectReason("");
                        }}
                        disabled={isBusy}
                        className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer disabled:opacity-50"
                      >
                        <IconX size={16} className="inline mr-1 text-slate-500" stroke={2} />
                        {t("reject")}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── Sección 2: historial ─── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
            {t("historyHeading")}
            <InfoTooltip content={t("historyTooltip")} />
          </h2>
          <ColumnMenu {...cols} />
        </div>

        <div className={VISIBLE_SCROLLBAR}>
          <table className="w-full text-xs table-fixed">
            <thead className="bg-slate-50/80 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
              <tr>
                {HISTORY_COLUMNS.filter((c) => cols.isVisible(c.id)).map((c) => (
                  <ResizableTh key={c.id} minWidth={c.minWidth} className="py-2.5 px-3 font-semibold text-left text-[#1B2A41] dark:text-slate-200">
                    {t(`col_${c.id}`)}
                  </ResizableTh>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {historyPg.paged.length === 0 ? (
                <tr>
                  <td colSpan={HISTORY_COLUMNS.length} className="py-8 text-center text-slate-500 dark:text-slate-400">
                    {t("emptyHistory")}
                  </td>
                </tr>
              ) : (
                historyPg.paged.map((h: ApprovalHistoryItem) => {
                  const Icon = ACTION_ICONS[h.actionType];
                  return (
                    <tr key={h.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      {cols.isVisible("resource") && (
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Icon size={15} className="text-[#0078D4] shrink-0" stroke={1.5} />
                            <span className={`font-semibold text-[#1B2A41] dark:text-slate-100 ${CELL}`} title={h.resourceName}>
                              {h.resourceName}
                            </span>
                          </div>
                          <span className="block text-[10px] text-slate-500 dark:text-slate-400 truncate">
                            {h.resourceTypeDisplay}
                          </span>
                        </td>
                      )}
                      {cols.isVisible("action") && (
                        <td className="py-2.5 px-3">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-blue-600 whitespace-nowrap">
                            {h.actionType}
                          </span>
                        </td>
                      )}
                      {cols.isVisible("savings") && (
                        <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white tabular-nums whitespace-nowrap">
                          {money(h.monthlySavingsUSD)}
                        </td>
                      )}
                      {cols.isVisible("status") && (
                        <td className="py-2.5 px-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md whitespace-nowrap ${STATUS_BADGE[h.status]}`}>
                            {t(`status_${h.status}`)}
                          </span>
                        </td>
                      )}
                      {cols.isVisible("resolvedBy") && (
                        <td className={`py-2.5 px-3 text-slate-600 dark:text-slate-300 ${CELL}`} title={h.resolvedBy}>
                          {h.resolvedBy}
                        </td>
                      )}
                      {cols.isVisible("resolvedAt") && (
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 tabular-nums whitespace-nowrap">
                          {dateTime(h.resolvedAt)}
                        </td>
                      )}
                      {cols.isVisible("arm") && (
                        <td className="py-2.5 px-3">
                          {h.armExecutionStatus ? (
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-md border whitespace-nowrap ${
                                h.armExecutionStatus === "Succeeded"
                                  ? "border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0078D4]"
                                  : h.armExecutionStatus === "Failed"
                                    ? "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800"
                                    : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600"
                              }`}
                            >
                              {h.armExecutionStatus}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400">—</span>
                          )}
                        </td>
                      )}
                      {cols.isVisible("actions") && (
                        <td className="py-2.5 px-3">
                          <button onClick={() => setDetailItem(h)} className="cursor-pointer bg-transparent" title={t("viewAuditLog")}>
                            <IconEye size={16} className="text-slate-400 hover:text-[#0078D4]" stroke={1.5} />
                          </button>
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
          page={historyPg.page}
          totalPages={historyPg.totalPages}
          pageSize={historyPg.pageSize}
          total={historyPg.total}
          setPage={historyPg.setPage}
          setPageSize={historyPg.setPageSize}
          pageSizes={[15, 30, 45, 60]}
        />
      </div>

      {/* ─── Modal: confirmación de aprobación ─── */}
      {approveTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[100]">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
                <IconCheck size={18} className="text-[#0078D4]" stroke={1.5} />
                {t("confirmAction", { action: t(`action_${approveTarget.actionType}`).toLowerCase() })}
              </h3>
              <button onClick={() => setApproveTarget(null)} className="cursor-pointer bg-transparent">
                <IconX size={18} className="text-slate-400" stroke={1.5} />
              </button>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-semibold text-[#1B2A41] dark:text-slate-100">{approveTarget.resourceName}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {approveTarget.resourceTypeDisplay} · {approveTarget.resourceGroup} · {approveTarget.subscriptionName}
              </p>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
              <h4 className="text-[11px] font-bold text-[#1B2A41] dark:text-slate-100">{t("safetyChecklist")}</h4>

              {approveTarget.canSnapshot ? (
                <label className="flex items-start gap-2 text-[11px] text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={withSnapshot}
                    onChange={(e) => setWithSnapshot(e.target.checked)}
                    className="accent-[#0054A6] cursor-pointer mt-0.5"
                  />
                  <span>
                    <IconCamera size={13} className="inline mr-1 text-[#0078D4]" stroke={1.5} />
                    {t.rich("snapshotCheckbox", { b: (c) => <strong>{c}</strong> })}
                  </span>
                </label>
              ) : approveTarget.isDestructive ? (
                <p className="text-[11px] text-slate-700 dark:text-slate-300">
                  {t("noSnapshotWarning")}
                </p>
              ) : null}

              {approveTarget.requiresReboot && (
                <p className="text-[11px] text-slate-700 dark:text-slate-300">
                  <IconAlertTriangle size={13} className="inline text-amber-600 mr-1" stroke={1.5} />
                  {t("serviceInterrupted")}
                </p>
              )}

              {approveTarget.actionType === "RIGHTSIZE_VM" && !approveTarget.targetConfiguration && (
                <p className="text-[11px] text-rose-700 dark:text-rose-400">
                  {t("missingTargetSku")}
                </p>
              )}

              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                {t("armImmediateNote")}
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setApproveTarget(null)}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                {t("cancel")}
              </button>
              <button
                onClick={() => {
                  const target = approveTarget;
                  setApproveTarget(null);
                  resolve(target, "APPROVE", { createBackupSnapshot: withSnapshot && target.canSnapshot });
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer"
              >
                <IconCheck size={16} className="inline mr-1.5" stroke={2} />
                {t("approveAndRun")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal: rechazo con justificación ─── */}
      {rejectTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[100]">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
                <IconX size={18} className="text-[#0078D4]" stroke={1.5} />
                {t("rejectTitle")}
              </h3>
              <button onClick={() => setRejectTarget(null)} className="cursor-pointer bg-transparent">
                <IconX size={18} className="text-slate-400" stroke={1.5} />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              {t.rich("rejectExplain", {
                who: rejectTarget.requestedBy,
                b: (c) => <strong>{c}</strong>,
              })}
            </p>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">{t("rejectReasonLabel")}</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={4}
                placeholder={t("rejectReasonPlaceholder")}
                className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRejectTarget(null)}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                {t("cancel")}
              </button>
              <button
                onClick={() => {
                  if (!rejectReason.trim()) {
                    toast.error(t("rejectNeedsReason"));
                    return;
                  }
                  const target = rejectTarget;
                  setRejectTarget(null);
                  resolve(target, "REJECT", { rejectionReason: rejectReason.trim() });
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-[#0078D4] text-white hover:bg-[#0060AA] transition cursor-pointer"
              >
                {t("rejectTitle")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal: detalle de auditoría ─── */}
      {detailItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[100]">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
                <IconInfoCircle size={18} className="text-[#0078D4]" stroke={1.5} />
                {t("auditLogTitle")}
              </h3>
              <button onClick={() => setDetailItem(null)} className="cursor-pointer bg-transparent">
                <IconX size={18} className="text-slate-400" stroke={1.5} />
              </button>
            </div>

            <dl className="space-y-2 text-[11px]">
              {[
                [t("auditResource"), `${detailItem.resourceName} (${detailItem.resourceTypeDisplay})`],
                [t("auditAction"), `${detailItem.actionType} — ${t(`action_${detailItem.actionType}`)}`],
                [t("auditSavings"), money(detailItem.monthlySavingsUSD)],
                [t("auditDecision"), t(`status_${detailItem.status}`)],
                [t("auditResolvedBy"), detailItem.resolvedBy],
                [t("auditDate"), dateTime(detailItem.resolvedAt)],
                [t("auditArmResult"), detailItem.armExecutionStatus || t("notApplicable")],
              ].map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                  <dt className="text-slate-500 dark:text-slate-400 shrink-0">{k}</dt>
                  <dd className="text-slate-800 dark:text-slate-200 font-medium text-right break-words">{v}</dd>
                </div>
              ))}
            </dl>

            {detailItem.rejectionReason && (
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <h4 className="text-[11px] font-bold text-[#1B2A41] dark:text-slate-100 mb-1">{t("rejectReasonLabel")}</h4>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">{detailItem.rejectionReason}</p>
              </div>
            )}

            {detailItem.armExecutionDetail && (
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                <h4 className="text-[11px] font-bold text-[#1B2A41] dark:text-slate-100 mb-1">{t("armResponse")}</h4>
                <p className="text-[11px] font-mono text-slate-600 dark:text-slate-400 break-all">
                  {detailItem.armExecutionDetail}
                </p>
              </div>
            )}

            {detailItem.backupSnapshotId && (
              <div className="p-3 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/30">
                <h4 className="text-[11px] font-bold text-[#1B2A41] dark:text-slate-100 mb-1">
                  <IconCamera size={13} className="inline mr-1 text-[#0078D4]" stroke={1.5} />
                  {t("safetySnapshot")}
                </h4>
                <p className="text-[11px] font-mono text-slate-600 dark:text-slate-400 break-all">
                  {detailItem.backupSnapshotId}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                  {t("snapshotBillingNote")}
                </p>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={() => setDetailItem(null)}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                {t("close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
