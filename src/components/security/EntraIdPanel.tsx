"use client";

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

const TYPE_LABELS: Record<EntraResourceType, string> = {
  UserLicense: "Usuario Corporativo",
  ServicePrincipal: "Service Principal",
  DomainServices: "Entra Domain Services",
  ExternalID_Tenant: "External ID",
};

function buildFetcher(instance: IPublicClientApplication, accounts: AccountInfo[], isMock: boolean) {
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
      throw new Error(err.error || "Error al cargar Microsoft Entra ID");
    }
    return res.json();
  };
}

function ActivityBadge({ item }: { item: EntraIdResourceItem }) {
  const map = {
    Active: { label: "Activo (<90d)", cls: "border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400" },
    Inactive: { label: "Inactivo (>90d)", cls: "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400" },
    Disabled: { label: "Deshabilitado", cls: "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400" },
    Unknown: { label: "Sin telemetría", cls: "border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-500" },
  } as const;
  const cfg = map[item.activityStatus];
  const title =
    item.activityStatus === "Unknown"
      ? "Microsoft Graph no expone signInActivity para este tenant (requiere AuditLog.Read.All y licencia Entra ID P1)"
      : item.inactiveDays === null
        ? "Nunca inició sesión"
        : item.inactiveDays !== undefined
          ? `Último logon hace ${item.inactiveDays} días`
          : undefined;
  return (
    <span
      title={title}
      className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 whitespace-nowrap ${cfg.cls}`}
    >
      {cfg.label}
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
              <span className="truncate">{action.title}</span>
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Ahorro estimado: {formatCurrency(action.estimatedSavingsUSD)}/mes
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
            aria-label="Cerrar"
          >
            <IconX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">{action.description}</p>

          <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 flex items-start gap-2">
            <IconAlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" stroke={2} />
            <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
              Revisar la lista antes de desasignar. Las cuentas de servicio, las de{" "}
              <span className="font-semibold">break-glass</span> y las de personal en licencia prolongada no
              inician sesión por diseño, y quitarles la licencia puede dejarlas sin acceso justo cuando se las
              necesita.
            </p>
          </div>

          {principals.length > 0 && (
            <div>
              <h3 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 mb-2">
                Principales afectados ({principals.length})
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
                Exportar lista de desasignación
              </button>
            )}
            <button
              onClick={() => onOpenCommands(action)}
              className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition flex items-center gap-1.5 cursor-pointer"
            >
              <IconTerminal2 className="w-4 h-4" />
              Ver script Graph / PowerShell
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
  const [copied, setCopied] = useState<"cli" | "ps" | null>(null);
  if (!action) return null;

  const cmd = buildEntraIdRemediationCommand(action);
  const copy = (text: string, which: "cli" | "ps") => {
    navigator.clipboard.writeText(text);
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
          aria-label="Cerrar"
        >
          <IconX className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <IconTerminal2 className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
          <div className="pr-8">
            <h2 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">{action.title}</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{action.description}</p>
          </div>
        </div>

        <div className="mb-4 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
          {action.estimatedSavingsUSD > 0 ? (
            <>
              <span className="text-xs text-slate-600 dark:text-slate-400">Ahorro mensual estimado: </span>
              <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(action.estimatedSavingsUSD)}
              </span>
            </>
          ) : (
            <span className="text-xs text-slate-600 dark:text-slate-400">
              Sin ahorro cuantificable: es una acción de <span className="font-bold">postura de seguridad</span>.
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
                onClick={() => copy(text, key)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border bg-white dark:bg-slate-900 transition flex items-center gap-1 cursor-pointer ${
                  copied === key
                    ? "border-emerald-600 text-emerald-600"
                    : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                }`}
              >
                {copied === key ? <IconCheck className="w-3.5 h-3.5" /> : <IconCopy className="w-3.5 h-3.5" />}
                {copied === key ? "Copiado" : "Copiar"}
              </button>
            </div>
            <pre className="p-3.5 bg-slate-950 text-slate-100 rounded-xl font-mono text-[11px] overflow-x-auto border border-slate-800 leading-relaxed whitespace-pre-wrap">
              {text}
            </pre>
          </div>
        ))}

        <p className="text-[10px] text-slate-400 mt-2">
          Los placeholders entre &lt;&gt; deben completarse. La plataforma no ejecuta cambios en el directorio.
        </p>
      </div>
    </div>
  );
}

// ─── Componente Principal ───
export default function EntraIdPanel() {
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

  const fetcher = useMemo(() => buildFetcher(instance, accounts, isMock), [instance, accounts, isMock]);

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
      `"${TYPE_LABELS[r.resourceType]}"`,
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
        name: TYPE_LABELS[type],
        Activas: items.filter((r) => r.activityStatus === "Active").length,
        Inactivas: items.filter((r) => r.activityStatus === "Inactive").length,
        Deshabilitadas: items.filter((r) => r.activityStatus === "Disabled").length,
      };
    };
    return [bucket("UserLicense"), bucket("ServicePrincipal")].filter(
      (b) => b.Activas + b.Inactivas + b.Deshabilitadas > 0
    );
  }, [resourcesList]);

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado ─── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconId className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
              <span>Entra ID — Gobernanza de Identidades y Licenciamiento</span>
              <InfoTooltip
                content="Entra ID mezcla dos modelos de facturación que Azure nunca muestra juntos: los recursos ARM medidos (Domain Services, External ID), que sí aparecen en Cost Management, y las licencias por usuario (P1/P2/Governance/Workload ID), que NO aparecen porque se facturan por el acuerdo de licenciamiento. El desperdicio de licencias suele ser el número más grande y el más invisible."
                position="bottom"
                align="left"
              />
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? "Live Microsoft Graph" : "Demo Sandbox"}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Recuperación de licencias, higiene de cuentas, Domain Services y ciclo de vida de service principals
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
            Actualizar telemetría
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
            Microsoft Graph no expone <code>signInActivity</code> en este tenant: requiere el permiso{" "}
            <span className="font-semibold">AuditLog.Read.All</span> y una licencia Entra ID P1. Sin ese dato no
            se puede afirmar que una cuenta esté inactiva, así que la auditoría de licencias huérfanas queda
            deshabilitada y las identidades figuran como <span className="font-semibold">Sin telemetría</span>.
          </p>
        </div>
      )}

      {/* ─── 4 Tarjetas KPI ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Costo ARM &amp; Medidos</span>
              <InfoTooltip content="Domain Services y External ID: lo único de Entra ID que aparece en Cost Management. Las licencias por usuario se facturan aparte, por el acuerdo de licenciamiento." />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {formatCurrency(summary.totalArmCostUSD)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.domainServicesCount} instancia(s) de Domain Services
            </div>
          </div>
          <IconCash className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Fuga en Licencias</span>
              <InfoTooltip content="Licencias compradas y sin asignar, más las asignadas a cuentas inactivas o deshabilitadas, sobre el total facturado. El denominador son las unidades COMPRADAS: Microsoft factura el acuerdo completo, estén repartidas o no. Este gasto no figura en Cost Management." />
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
              sobre {formatCurrency(summary.totalLicenseSpendUSD)} facturados
            </div>
          </div>
          <IconUserExclamation className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Identidades Administradas</span>
              <InfoTooltip content="Usuarios con licencia de Entra auditada, invitados B2B y service principals del directorio." />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {summary.totalUsersCount + summary.servicePrincipalsCount}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.totalUsersCount} usuarios · {summary.guestUsersCount} invitados ·{" "}
              {summary.servicePrincipalsCount} SP
            </div>
          </div>
          <IconUsersGroup className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Ahorro Potencial</span>
              <InfoTooltip content="Recuperación de licencias huérfanas más el rightsizing de Domain Services. Las acciones de postura (MFA) figuran en cero y no suman." />
            </div>
            <div className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(summary.potentialSavingsUSD)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.inactiveUsersCount} inactivos · {summary.disabledWithLicenseCount} deshabilitados con
              licencia
            </div>
          </div>
          <IconSparkles className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>
      </div>

      {/* ─── Fila 1: Distribución + Higiene de cuentas ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mb-3 flex items-center gap-1.5">
            Distribución de Licencias &amp; Servicios
            <InfoTooltip content="Reparto del gasto total de identidad entre recursos ARM medidos y licenciamiento, separando lo asignado de lo desperdiciado." />
          </h3>
          {summary.breakdownByCostType.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-xs text-slate-400">
              Sin costo de identidad registrado
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
                <RechartsTooltip formatter={(v) => formatCurrency(Number(v ?? 0))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mb-3 flex items-center gap-1.5">
            Higiene de Cuentas
            <InfoTooltip content="Cuentas activas frente a inactivas (sin logon hace más de 90 días) y deshabilitadas que aún retienen licencia." />
          </h3>
          {hygieneData.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-xs text-slate-400">
              Sin identidades con licencia auditada
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={224}>
              <BarChart data={hygieneData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                <RechartsTooltip />
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
            Licencias Compradas vs Asignadas
            <InfoTooltip content="Unidades del acuerdo de licenciamiento frente a las realmente asignadas. Las no asignadas se facturan igual." />
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
                    {formatCurrency(sku.wastedMonthlyUSD)}/mes desperdiciado
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
              placeholder="Buscar por recurso, usuario, UPN o service principal..."
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
            <option value="ALL">Categoría (Todas)</option>
            <option value="ARM">Servicios ARM (Domain Services / External ID)</option>
            <option value="USERS">Licenciamiento de Usuarios</option>
            <option value="WORKLOAD">Workload Identities</option>
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">Estado (Todos)</option>
            <option value="Active">Activo</option>
            <option value="Inactive">Inactivo (&gt;90 días)</option>
            <option value="Disabled">Cuenta deshabilitada</option>
            <option value="Unknown">Sin telemetría</option>
          </select>
        </div>
      </div>

      {/* ─── Tabla (scrollbar visible en macOS) ─── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
            Inventario y Gobernanza de Entra ID
          </h3>
          <InfoTooltip content="Recursos ARM de identidad y principales con licencia auditada, ordenados con el desperdicio primero." />
          <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400">{total} registros</span>
        </div>

        <div className={VISIBLE_SCROLLBAR}>
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
              <tr>
                <ResizableTh minWidth={230}>Recurso / Identidad</ResizableTh>
                <ResizableTh minWidth={160}>Tipo</ResizableTh>
                <ResizableTh minWidth={160}>Suscripción / Alcance</ResizableTh>
                <ResizableTh minWidth={180}>SKU / Nivel de Licencia</ResizableTh>
                <ResizableTh minWidth={140}>Estado de Actividad</ResizableTh>
                <ResizableTh minWidth={130}>Costo / Desperdicio</ResizableTh>
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
                        ? "Microsoft Graph no reporta identidades con licencias de Entra auditadas."
                        : "Ningún registro coincide con los filtros aplicados."}
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
                                <span className="truncate">{r.wasteReason}</span>
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">
                        {TYPE_LABELS[r.resourceType]}
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
                                  title: `Reclamar licencia de ${r.displayName}`,
                                  description: r.wasteReason || "Cuenta sin actividad reciente con licencia asignada.",
                                  category: "RECLAIM_USER_LICENSE",
                                  estimatedSavingsUSD: r.potentialSavingsUSD,
                                  confidence: "MEDIUM",
                                  actionType: "REMOVE_LICENSE_ASSIGNMENT",
                                  affectedPrincipals: [r.principalIdentifier || r.displayName],
                                })
                              }
                              className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition cursor-pointer whitespace-nowrap"
                            >
                              Reclamar Licencia ✨
                            </button>
                          )}
                          {r.resourceType === "DomainServices" && r.isWasteful && (
                            <button
                              onClick={() =>
                                setActiveRemediation({
                                  id: `manual-eds-${r.id}`,
                                  targetId: r.id,
                                  targetName: r.name,
                                  title: `Optimizar SKU de ${r.name}`,
                                  description: r.wasteReason || `Instancia en SKU ${r.skuTier}.`,
                                  category: "DOWNGRADE_DOMAIN_SERVICES",
                                  estimatedSavingsUSD: r.potentialSavingsUSD,
                                  confidence: "MEDIUM",
                                  actionType: "SET_EDS_SKU_STANDARD",
                                })
                              }
                              className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-[#00AEEF] bg-white dark:bg-slate-900 text-[#00AEEF] hover:bg-sky-50/50 dark:hover:bg-sky-950/40 transition cursor-pointer whitespace-nowrap"
                            >
                              Optimizar Tier ✨
                            </button>
                          )}
                          {!r.isWasteful && <span className="text-[11px] text-slate-400">Sin acción requerida</span>}
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
            Recomendaciones Priorizadas de Entra ID
            <InfoTooltip content="Ordenadas por ahorro mensual. Las acciones de postura, como la prevención de fraude por SMS, figuran con $0.00 porque su impacto no se puede cuantificar sin datos de fraude." />
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Ahorro potencial total identificado:{" "}
            <span className="font-bold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(summary.potentialSavingsUSD)}/mes
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
                      {action.category}
                    </span>
                    {action.estimatedSavingsUSD > 0 && (
                      <span className="text-xs font-extrabold text-emerald-600">
                        +{formatCurrency(action.estimatedSavingsUSD)}/mes
                      </span>
                    )}
                  </div>
                  <h4 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 leading-snug">
                    {action.title}
                  </h4>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-4 leading-relaxed">
                    {action.description}
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center gap-2">
                  <span className="text-[10px] text-slate-400 font-medium">Confianza: {action.confidence}</span>
                  <button
                    onClick={() =>
                      action.affectedPrincipals && action.affectedPrincipals.length > 0
                        ? setAuditAction(action)
                        : setActiveRemediation(action)
                    }
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition flex items-center gap-1 cursor-pointer"
                  >
                    <IconTerminal2 className="w-3.5 h-3.5" />
                    {action.affectedPrincipals && action.affectedPrincipals.length > 0 ? "Auditar ✨" : "Remediar ✨"}
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              <IconCheck className="w-6 h-6 text-emerald-500 mx-auto mb-1" />
              No se detectaron licencias huérfanas ni instancias sobredimensionadas.
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
