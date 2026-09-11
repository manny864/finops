"use client";
import { useTranslations } from "next-intl";
import { useTextoPorCategoria, resolverComentarios } from "@/lib/recommendationText";
import { EDS_SKU_MONTHLY_USD, INACTIVE_USER_DAYS } from "@/types/azureEntraId.types";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import type { IPublicClientApplication, AccountInfo } from "@azure/msal-browser";
import {
  IconCash,
  IconUserExclamation,
  IconUsersGroup,
  IconSparkles,
  IconRotateClockwise,
  IconSearch,
  IconDatabaseExport,
  IconTerminal2,
  IconX,
  IconCheck,
  IconCopy,
  IconAlertTriangle,
  IconUser,
  IconId,
  IconServer,
  IconWorldWww,
  IconInfoCircle,
} from "@tabler/icons-react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
} from "recharts";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { buildEntraIdRemediationCommand } from "@/lib/aiRemediations";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import InfoTooltip from "@/components/InfoTooltip";
import { TOOLTIP_TEMA } from "@/lib/chartTooltip";
import type {
  EntraIdPayload,
  EntraIdRemediationAction,
  EntraIdResourceItem,
  EntraResourceType,
} from "@/types/azureEntraId.types";

/** Scrollbar horizontal siempre visible: en macOS los overlay desaparecen. */
const VISIBLE_SCROLLBAR =
  "overflow-x-auto [scrollbar-width:thin] [scrollbar-color:theme(colors.slate.300)_theme(colors.slate.100)] " +
  "dark:[scrollbar-color:theme(colors.slate.600)_theme(colors.slate.800)] " +
  "[&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar-thumb]:rounded-full " +
  "[&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 " +
  "[&::-webkit-scrollbar-track]:bg-slate-100 dark:[&::-webkit-scrollbar-track]:bg-slate-800";

const formatCurrency = (val: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);

const TYPE_ICONS: Record<EntraResourceType, React.ComponentType<{ className?: string; stroke?: number }>> = {
  UserLicense: IconUser,
  ServicePrincipal: IconId,
  DomainServices: IconServer,
  ExternalID_Tenant: IconWorldWww,
};

// Claves, no rotulos: el mapa vive fuera del componente y no tiene `t`.
const TYPE_LABELS: Record<EntraResourceType, string> = {
  UserLicense: "type_UserLicense",
  ServicePrincipal: "type_ServicePrincipal",
  DomainServices: "type_DomainServices",
  ExternalID_Tenant: "type_ExternalID_Tenant",
};

// `t` entra por parametro: buildFetcher no es un componente ni un hook y no
// puede llamar a useTranslations.
function buildFetcher(instance: IPublicClientApplication, accounts: AccountInfo[], isMock: boolean, t: (k: string) => string) {
  return async (url: string) => {
    const headers: Record<string, string> = {};
    if (!isMock && accounts.length > 0) {
      try {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
      } catch {
        // Se deja propagar el 401 del servidor; no hay mock de rescate.
      }
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || t("loadError"));
    }
    return res.json();
  };
}

function ActivityBadge({ item }: { item: EntraIdResourceItem }) {
  const t = useTranslations("EntraIdPanel");
  const map = {
    Active: { cls: "border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400" },
    Inactive: { cls: "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400" },
    Disabled: { cls: "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400" },
    Unknown: { cls: "border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-500" },
  } as const;
  const cfg = map[item.activityStatus];
  const title =
    item.activityStatus === "Unknown"
      ? t("actTip_Unknown")
      : item.inactiveDays === null
        ? t("actTip_never")
        : item.inactiveDays !== undefined
          ? t("actTip_lastLogon", { days: item.inactiveDays })
          : undefined;
  return (
    <span
      title={title}
      className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 whitespace-nowrap ${cfg.cls}`}
    >
      {t(`act_${item.activityStatus}`)}
    </span>
  );
}

// ─── Drawer de Auditoría de Licencias (z-50) ───
function LicenseAuditDrawer({
  action,
  onClose,
  onOpenCommands,
}: {
  action: EntraIdRemediationAction | null;
  onClose: () => void;
  onOpenCommands: (a: EntraIdRemediationAction) => void;
}) {
  const t = useTranslations("EntraIdPanel");
  const textoRem = useTextoPorCategoria("EntraIdPanel");
  if (!action) return null;

  const principals = action.affectedPrincipals || [];

  const exportList = () => {
    const csv =
      "data:text/csv;charset=utf-8," +
      ["UserPrincipalName,SkuPartNumber,Action", ...principals.map((p) => `"${p}","${action.targetId}",RemoveLicense`)].join(
        "\n"
      );
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `desasignacion-${action.targetId}-${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-2xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl overflow-y-auto z-50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconUserExclamation className="w-5 h-5 text-[#0078D4] shrink-0" stroke={1.5} />
              <span className="truncate">{textoRem(action, "title")}</span>
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              {t("estSavingsPerMonth", { amount: formatCurrency(action.estimatedSavingsUSD) })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
            aria-label={t("close")}
          >
            <IconX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">{textoRem(action, "desc")}</p>

          <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 flex items-start gap-2">
            <IconAlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" stroke={2} />
            <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
              {t.rich("reviewBeforeUnassign", { b: (c) => <span className="font-semibold">{c}</span>, code: (c) => <code>{c}</code> })}
              
              {t("signInNote")}
              necesita.
            </p>
          </div>

          {principals.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 mb-2">
                {t("affectedPrincipals", { count: principals.length })}
              </h3>
              <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
                {principals.map((p) => (
                  <div
                    key={p}
                    className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300 truncate"
                    title={p}
                  >
                    {p}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {principals.length > 0 && (
              <button
                onClick={exportList}
                className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer"
              >
                <IconDatabaseExport className="w-4 h-4 text-[#0078D4]" />
                {t("exportDeassign")}
              </button>
            )}
            <button
              onClick={() => onOpenCommands(action)}
              className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition flex items-center gap-1.5 cursor-pointer"
            >
              <IconTerminal2 className="w-4 h-4" />
              {t("viewScript")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de Remediación (z-50) ───
function EntraRemediationModal({
  action,
  onClose,
}: {
  action: EntraIdRemediationAction | null;
  onClose: () => void;
}) {
  const t = useTranslations("EntraIdPanel");
  const tc = useTranslations("Common");
  const textoRem = useTextoPorCategoria("EntraIdPanel");
  const [copied, setCopied] = useState<"cli" | "ps" | null>(null);
  if (!action) return null;

  const cmd = buildEntraIdRemediationCommand(action);
  const copy = (text: string, which: "cli" | "ps") => {
    navigator.clipboard.writeText(resolverComentarios(text, t));
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl p-6 relative z-[100] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          aria-label={t("close")}
        >
          <IconX className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <IconTerminal2 className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
          <div className="pr-8">
            <h2 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">{textoRem(action, "title")}</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{textoRem(action, "desc")}</p>
          </div>
        </div>

        <div className="mb-4 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
          {action.estimatedSavingsUSD > 0 ? (
            <>
              <span className="text-xs text-slate-600 dark:text-slate-400">{t("estimatedMonthlySavings")} </span>
              <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(action.estimatedSavingsUSD)}
              </span>
            </>
          ) : (
            <span className="text-xs text-slate-600 dark:text-slate-400">
              {t.rich("noQuantifiableSavings", { b: (c) => <span className="font-bold">{c}</span> })}
            </span>
          )}
        </div>

        {([
          ["Azure CLI / Graph REST", cmd.cli, "cli"],
          ["Microsoft.Graph PowerShell", cmd.powershell, "ps"],
        ] as const).map(([label, text, key]) => (
          <div key={key} className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">{label}</span>
              <button
                onClick={() => copy(resolverComentarios(text, t), key)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border bg-white dark:bg-slate-900 transition flex items-center gap-1 cursor-pointer ${
                  copied === key
                    ? "border-emerald-600 text-emerald-600"
                    : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                }`}
              >
                {copied === key ? <IconCheck className="w-3.5 h-3.5" /> : <IconCopy className="w-3.5 h-3.5" />}
                {copied === key ? tc("copied") : tc("copy")}
              </button>
            </div>
            <pre className="p-3.5 bg-slate-950 text-slate-100 rounded-xl font-mono text-[11px] overflow-x-auto border border-slate-800 leading-relaxed whitespace-pre-wrap">
              {resolverComentarios(text, t)}
            </pre>
          </div>
        ))}

        <p className="text-[10px] text-slate-400 mt-2">
          {t("placeholdersNote")}
        </p>
      </div>
    </div>
  );
}

// ─── Componente Principal ───
export default function EntraIdPanel() {
  const t = useTranslations("EntraIdPanel");
  const tc = useTranslations("Common");
  const textoRem = useTextoPorCategoria("EntraIdPanel");
  const { selectedTenant } = useTenant();
  const tenantId = selectedTenant?.id || "";
  const searchParams = useSearchParams();
  const { instance, accounts } = useMsal();

  const isMock = useMemo(() => {
    return (
      isMockTenant(tenantId) ||
      searchParams.get("mock") === "true" ||
      tenantId.startsWith("demo-") ||
      tenantId.startsWith("mock-")
    );
  }, [tenantId, searchParams]);

  const fetcher = useMemo(() => buildFetcher(instance, accounts, isMock, t), [instance, accounts, isMock, t]);

  const apiUrl = `/api/intelligence/security/entra-id?tenantId=${encodeURIComponent(tenantId)}`;
  const { data, error, isValidating, mutate } = useSWR<EntraIdPayload>(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [selectedStatus, setSelectedStatus] = useState("ALL");

  const [auditAction, setAuditAction] = useState<EntraIdRemediationAction | null>(null);
  const [activeRemediation, setActiveRemediation] = useState<EntraIdRemediationAction | null>(null);

  const resourcesList = useMemo(() => data?.resources || [], [data?.resources]);

  const filteredResources = useMemo(() => {
    return resourcesList
      .filter((r) => {
        if (searchTerm) {
          const term = searchTerm.toLowerCase();
          const hit =
            r.displayName.toLowerCase().includes(term) ||
            r.name.toLowerCase().includes(term) ||
            (r.principalIdentifier || "").toLowerCase().includes(term) ||
            r.skuTier.toLowerCase().includes(term);
          if (!hit) return false;
        }
        if (selectedCategory === "ARM" && r.resourceType !== "DomainServices" && r.resourceType !== "ExternalID_Tenant")
          return false;
        if (selectedCategory === "USERS" && r.resourceType !== "UserLicense") return false;
        if (selectedCategory === "WORKLOAD" && r.resourceType !== "ServicePrincipal") return false;
        if (selectedStatus !== "ALL" && r.activityStatus !== selectedStatus) return false;
        return true;
      })
      .sort((a, b) => {
        // Primero el desperdicio, luego el costo: la fuga arriba.
        if (a.isWasteful !== b.isWasteful) return a.isWasteful ? -1 : 1;
        return b.monthlyCostUSD - a.monthlyCostUSD;
      });
  }, [resourcesList, searchTerm, selectedCategory, selectedStatus]);

  const {
    paged: paginatedResources,
    page,
    totalPages,
    pageSize,
    setPage,
    setPageSize,
    total,
  } = usePagination(filteredResources, 15);

  const handleExportCSV = () => {
    if (filteredResources.length === 0) return;
    const headers = [
      "Name",
      "Display Name",
      "Type",
      "Principal",
      "Scope",
      "SKU / License Tier",
      "Assigned Licenses",
      "Last Sign In",
      "Inactive Days",
      "Account Enabled",
      "Activity Status",
      "Monthly Cost USD",
      "Potential Savings USD",
    ];
    const rows = filteredResources.map((r) => [
      `"${r.name}"`,
      `"${r.displayName}"`,
      `"${t(TYPE_LABELS[r.resourceType])}"`,
      `"${r.principalIdentifier || ""}"`,
      `"${r.subscriptionName}"`,
      `"${r.skuTier}"`,
      `"${r.assignedLicenses.join(" | ")}"`,
      `"${r.lastSignInDate || ""}"`,
      r.inactiveDays ?? "",
      r.isAccountEnabled,
      `"${r.activityStatus}"`,
      r.monthlyCostUSD.toFixed(2),
      r.potentialSavingsUSD.toFixed(2),
    ]);
    const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `entra-id-governance-${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const summary = data?.summary || {
    totalArmCostUSD: 0,
    totalLicenseWasteUSD: 0,
    totalLicenseSpendUSD: 0,
    totalUsersCount: 0,
    guestUsersCount: 0,
    inactiveUsersCount: 0,
    disabledWithLicenseCount: 0,
    servicePrincipalsCount: 0,
    inactiveServicePrincipalsCount: 0,
    domainServicesCount: 0,
    workloadIdentitiesCount: 0,
    potentialSavingsUSD: 0,
    breakdownByCostType: [],
    licenseSkus: [],
    signInActivityAvailable: true,
  };

  /** Higiene de cuentas: activas vs inactivas vs deshabilitadas por tipo. */
  const hygieneData = useMemo(() => {
    const bucket = (type: EntraResourceType) => {
      const items = resourcesList.filter((r) => r.resourceType === type);
      return {
        name: t(TYPE_LABELS[type]),
        Activas: items.filter((r) => r.activityStatus === "Active").length,
        Inactivas: items.filter((r) => r.activityStatus === "Inactive").length,
        Deshabilitadas: items.filter((r) => r.activityStatus === "Disabled").length,
      };
    };
    return [bucket("UserLicense"), bucket("ServicePrincipal")].filter(
      (b) => b.Activas + b.Inactivas + b.Deshabilitadas > 0
    );
  }, [resourcesList, t]);

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado ─── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconId className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
              <span>{t("boardTitle")}</span>
              <InfoTooltip
                content={t("boardTooltip")}
                position="bottom"
                align="left"
              />
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? "Live Microsoft Graph" : "Demo Sandbox"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t("pageSubtitle")}
          </p>
        </div>

        <div className="flex items-center gap-2 self-stretch sm:self-auto">
          <button
            onClick={handleExportCSV}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer shadow-xs"
          >
            <IconDatabaseExport className="w-4 h-4 text-[#0078D4]" />
            Exportar CSV
          </button>
          <button
            onClick={() => mutate()}
            disabled={isValidating}
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
          >
            <IconRotateClockwise className={`w-4 h-4 text-[#0078D4] ${isValidating ? "animate-spin" : ""}`} />
            {t("refreshTelemetry")}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 flex items-start gap-2">
          <IconAlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" stroke={1.5} />
          <p className="text-xs text-red-700 dark:text-red-400">{String(error.message || error)}</p>
        </div>
      )}

      {/* Aviso cuando Graph no expone signInActivity: sin él no se puede afirmar
          que una cuenta esté inactiva, y el módulo lo dice en vez de callarlo. */}
      {data && !summary.signInActivityAvailable && (
        <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 flex items-start gap-2">
          <IconInfoCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" stroke={1.5} />
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            {t.rich("graphNoSignInNote", { b: (c) => <span className="font-semibold">{c}</span>, code: (c) => <code>{c}</code> })}
          </p>
        </div>
      )}

      {/* ─── 4 Tarjetas KPI ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>{t("kpiArmCost")}</span>
              <InfoTooltip content={t("kpiArmCostTooltip")} />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {formatCurrency(summary.totalArmCostUSD)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t("domainServicesCount", { count: summary.domainServicesCount })}
            </div>
          </div>
          <IconCash className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>{t("kpiLicenseWaste")}</span>
              <InfoTooltip content={t("kpiWasteTooltip")} />
            </div>
            <div
              className={`text-2xl font-extrabold ${
                summary.totalLicenseWasteUSD > 0
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-[#1B2A41] dark:text-slate-100"
              }`}
            >
              {formatCurrency(summary.totalLicenseWasteUSD)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t("overBilled", { amount: formatCurrency(summary.totalLicenseSpendUSD) })}
            </div>
          </div>
          <IconUserExclamation className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>{t("kpiManagedIdentities")}</span>
              <InfoTooltip content={t("kpiIdentitiesTooltip")} />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {summary.totalUsersCount + summary.servicePrincipalsCount}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t("usersBreakdown", { users: summary.totalUsersCount, guests: summary.guestUsersCount })}{" "}
              {summary.servicePrincipalsCount} SP
            </div>
          </div>
          <IconUsersGroup className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>{t("kpiPotentialSavings")}</span>
              <InfoTooltip content={t("kpiPotentialSavingsTooltip")} />
            </div>
            <div className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(summary.potentialSavingsUSD)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t("inactiveBreakdown", { inactive: summary.inactiveUsersCount, disabled: summary.disabledWithLicenseCount })}
              
            </div>
          </div>
          <IconSparkles className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>
      </div>

      {/* ─── Fila 1: Distribución + Higiene de cuentas ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mb-3 flex items-center gap-1.5">
            {t("licenseDistribution")}
            <InfoTooltip content={t("licenseDistributionTooltip")} />
          </h3>
          {summary.breakdownByCostType.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-xs text-slate-400">
              {t("noIdentityCost")}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={224}>
              <PieChart>
                <Pie
                  data={summary.breakdownByCostType}
                  dataKey="costUSD"
                  nameKey="typeName"
                  innerRadius={52}
                  outerRadius={82}
                  paddingAngle={2}
                >
                  {summary.breakdownByCostType.map((entry) => (
                    <Cell key={entry.typeName} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip formatter={(v) => formatCurrency(Number(v ?? 0))} {...TOOLTIP_TEMA} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mb-3 flex items-center gap-1.5">
            {t("accountHygieneTitle")}
            <InfoTooltip content={t("activityTooltip")} />
          </h3>
          {hygieneData.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-xs text-slate-400">
              {t("noAuditedIdentities")}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={224}>
              <BarChart data={hygieneData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                <RechartsTooltip {...TOOLTIP_TEMA} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Activas" fill="#0078D4" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Inactivas" fill="#38BDF8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Deshabilitadas" fill="#94A3B8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ─── Licencias compradas vs asignadas ─── */}
      {summary.licenseSkus.length > 0 && (
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mb-3 flex items-center gap-1.5">
            {t("purchasedVsAssigned")}
            <InfoTooltip content={t("purchasedTooltip")} />
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {summary.licenseSkus.map((sku) => (
              <div
                key={sku.skuPartNumber}
                className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40"
              >
                <div className="text-[11px] font-bold text-[#1B2A41] dark:text-slate-100 truncate" title={sku.displayName}>
                  {sku.displayName}
                </div>
                <div className="text-lg font-extrabold text-[#1B2A41] dark:text-slate-100 mt-1">
                  {sku.consumedUnits}
                  <span className="text-sm font-semibold text-slate-400"> / {sku.prepaidUnits}</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden mt-1.5">
                  <div
                    className="h-full rounded-full bg-[#0078D4]"
                    style={{
                      width: `${sku.prepaidUnits > 0 ? Math.min(100, (sku.consumedUnits / sku.prepaidUnits) * 100) : 0}%`,
                    }}
                  />
                </div>
                {sku.wastedMonthlyUSD > 0 && (
                  <div className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold mt-1.5">
                    {t("wastedPerMonth", { amount: formatCurrency(sku.wastedMonthlyUSD) })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Filtros ─── */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="lg:col-span-3 relative">
            <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={t("searchPlaceholder")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
            />
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">{t("categoryAll")}</option>
            <option value="ARM">{t("categoryArm")}</option>
            <option value="USERS">{t("categoryLicensing")}</option>
            <option value="WORKLOAD">Workload Identities</option>
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">{t("statusAll")}</option>
            <option value="Active">{t("statusActive")}</option>
            <option value="Inactive">{t("statusInactive")}</option>
            <option value="Disabled">{t("statusDisabled")}</option>
            <option value="Unknown">{t("noTelemetry")}</option>
          </select>
        </div>
      </div>

      {/* ─── Tabla (scrollbar visible en macOS) ─── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
            {t("inventoryTitle")}
          </h3>
          <InfoTooltip content={t("tableTooltip")} />
          <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400">{total} registros</span>
        </div>

        <div className={VISIBLE_SCROLLBAR}>
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
              <tr>
                <ResizableTh minWidth={230}>{t("colResource")}</ResizableTh>
                <ResizableTh minWidth={160}>{t("colType")}</ResizableTh>
                <ResizableTh minWidth={160}>{t("colScope")}</ResizableTh>
                <ResizableTh minWidth={180}>{t("colSku")}</ResizableTh>
                <ResizableTh minWidth={140}>{t("colActivity")}</ResizableTh>
                <ResizableTh minWidth={130}>{t("colCostWaste")}</ResizableTh>
                <ResizableTh minWidth={190}>Acciones</ResizableTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedResources.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-500 dark:text-slate-400">
                    <IconId className="w-7 h-7 text-[#0078D4] mx-auto mb-2" stroke={1.5} />
                    <p className="text-xs font-medium">
                      {resourcesList.length === 0
                        ? t("emptyNoIdentities")
                        : t("emptyNoMatches")}
                    </p>
                  </td>
                </tr>
              ) : (
                paginatedResources.map((r: EntraIdResourceItem) => {
                  const Icon = TYPE_ICONS[r.resourceType];
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                      <td className="px-3 py-2.5">
                        <div className="flex items-start gap-2">
                          <Icon className="w-4 h-4 text-[#0078D4] shrink-0 mt-0.5" stroke={1.5} />
                          <span className="min-w-[120px] max-w-[240px]">
                            <span
                              className="block font-semibold text-[#1B2A41] dark:text-slate-100 truncate"
                              title={r.displayName}
                            >
                              {r.displayName}
                            </span>
                            {r.principalIdentifier && (
                              <span
                                className="block text-[10px] text-slate-500 dark:text-slate-400 truncate"
                                title={r.principalIdentifier}
                              >
                                {r.principalIdentifier}
                              </span>
                            )}
                            {r.isWasteful && r.wasteReason && (
                              <span className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-semibold mt-0.5">
                                <IconAlertTriangle className="w-3 h-3" stroke={2} />
                                <span className="truncate">{t(r.wasteReason.key, r.wasteReason.params ?? {})}</span>
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">
                        {t(TYPE_LABELS[r.resourceType])}
                      </td>
                      <td
                        className="px-3 py-2.5 text-slate-600 dark:text-slate-400 min-w-[120px] max-w-[240px] truncate"
                        title={r.subscriptionName}
                      >
                        {r.subscriptionName}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300 bg-white dark:bg-slate-900 inline-block max-w-[180px] truncate"
                          title={r.skuTier}
                        >
                          {r.skuTier}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <ActivityBadge item={r} />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="font-bold text-[#1B2A41] dark:text-slate-100">
                          {formatCurrency(r.monthlyCostUSD)}
                        </span>
                        {r.potentialSavingsUSD > 0 && (
                          <span className="block text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                            recuperable {formatCurrency(r.potentialSavingsUSD)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {r.resourceType === "UserLicense" && r.isWasteful && (
                            <button
                              onClick={() =>
                                setAuditAction({
                                  id: `manual-reclaim-${r.id}`,
                                  targetId: r.assignedLicenses[0] || "AAD_PREMIUM",
                                  targetName: r.skuTier,
                                  // Misma categoria que la recomendacion del
                                  // servicio, con los datos de esta unica
                                  // cuenta: el texto sale del mismo lugar.
                                  params: {
                                    count: 1,
                                    sku: r.skuTier,
                                    disabled: r.activityStatus === "Disabled" ? 1 : 0,
                                    days: INACTIVE_USER_DAYS,
                                    price: r.potentialSavingsUSD,
                                  },
                                  category: "RECLAIM_USER_LICENSE",
                                  estimatedSavingsUSD: r.potentialSavingsUSD,
                                  confidence: "MEDIUM",
                                  actionType: "REMOVE_LICENSE_ASSIGNMENT",
                                  affectedPrincipals: [r.principalIdentifier || r.displayName],
                                })
                              }
                              className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition cursor-pointer whitespace-nowrap flex items-center gap-1"
                            >
                              <IconSparkles size={13} stroke={1.5} className="text-[#0054A6]" />
                              {t("btnReclaimLicense")}
                            </button>
                          )}
                          {r.resourceType === "DomainServices" && r.isWasteful && (
                            <button
                              onClick={() =>
                                setActiveRemediation({
                                  id: `manual-eds-${r.id}`,
                                  targetId: r.id,
                                  targetName: r.name,
                                  params: {
                                    name: r.name,
                                    tier: r.skuTier,
                                    currentCost: EDS_SKU_MONTHLY_USD[r.skuTier] ?? 0,
                                    standardCost: EDS_SKU_MONTHLY_USD.Standard,
                                  },
                                  category: "DOWNGRADE_DOMAIN_SERVICES",
                                  estimatedSavingsUSD: r.potentialSavingsUSD,
                                  confidence: "MEDIUM",
                                  actionType: "SET_EDS_SKU_STANDARD",
                                })
                              }
                              className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-[#00AEEF] bg-white dark:bg-slate-900 text-[#00AEEF] dark:text-cyan-400 hover:bg-sky-50/50 dark:hover:bg-sky-950/40 transition cursor-pointer whitespace-nowrap flex items-center gap-1"
                            >
                              <IconSparkles size={13} stroke={1.5} className="text-[#00AEEF]" />
                              {t("btnOptimizeTier")}
                            </button>
                          )}
                          {!r.isWasteful && <span className="text-[11px] text-slate-400">{t("noActionRequired")}</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800">
          <Pagination
            page={page}
            totalPages={totalPages}
            pageSize={pageSize}
            total={total}
            setPage={setPage}
            setPageSize={setPageSize}
            pageSizes={[15, 30, 45, 60]}
          />
        </div>
      </div>

      {/* ─── Recomendaciones ─── */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div>
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-1.5">
            {t("actionsTitle")}
            <InfoTooltip content={t("actionsTooltip")} />
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {t("totalPotentialSavings")}{" "}
            <span className="font-bold text-emerald-600 dark:text-emerald-400">
              {tc("amountPerMonth", { amount: formatCurrency(summary.potentialSavingsUSD) })}
            </span>
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {data?.remediations && data.remediations.length > 0 ? (
            data.remediations.map((action) => (
              <div
                key={action.id}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between space-y-3 hover:border-blue-300 dark:hover:border-blue-700 transition"
              >
                <div className="space-y-1.5">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 text-[#0054A6] bg-white dark:bg-slate-900 uppercase">
                      {t(`cat_${action.category}`)}
                    </span>
                    {action.estimatedSavingsUSD > 0 && (
                      <span className="text-xs font-extrabold text-emerald-600">
                        +{tc("amountPerMonth", { amount: formatCurrency(action.estimatedSavingsUSD) })}
                      </span>
                    )}
                  </div>
                  <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 leading-snug">
                    {textoRem(action, "title")}
                  </h4>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-4 leading-relaxed">
                    {textoRem(action, "desc")}
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center gap-2">
                  <span className="text-[10px] text-slate-400 font-medium">{tc("confidence")}: {action.confidence}</span>
                  <button
                    onClick={() =>
                      action.affectedPrincipals && action.affectedPrincipals.length > 0
                        ? setAuditAction(action)
                        : setActiveRemediation(action)
                    }
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] dark:text-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition flex items-center gap-1 cursor-pointer"
                  >
                    <IconTerminal2 className="w-3.5 h-3.5" />
                    {action.affectedPrincipals && action.affectedPrincipals.length > 0 ? tc("audit") : tc("remediate")}
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              <IconCheck className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
              {t("noFindings")}
            </div>
          )}
        </div>
      </div>

      {/* ─── Capas superpuestas ─── */}
      <LicenseAuditDrawer
        action={auditAction}
        onClose={() => setAuditAction(null)}
        onOpenCommands={(a) => setActiveRemediation(a)}
      />
      <EntraRemediationModal action={activeRemediation} onClose={() => setActiveRemediation(null)} />
    </div>
  );
}
