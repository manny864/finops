"use client";
import { useTranslations } from "next-intl";

import React, { useState, useMemo } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import type { IPublicClientApplication, AccountInfo } from "@azure/msal-browser";
import {
  IconCash,
  IconKey,
  IconRepeat,
  IconShieldLock,
  IconRotateClockwise,
  IconSearch,
  IconDatabaseExport,
  IconTerminal2,
  IconX,
  IconCheck,
  IconCopy,
  IconAlertTriangle,
  IconChartAreaLine,
  IconPlugConnected,
  IconLock,
  IconLockOpen,
  IconSparkles,
} from "@tabler/icons-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";
import { buildKeyVaultRemediationCommand } from "@/lib/aiRemediations";
import Pagination, { usePagination } from "@/components/Pagination";
import ResizableTh from "@/components/ResizableTh";
import InfoTooltip from "@/components/InfoTooltip";
import type {
  KeyVaultPayload,
  KeyVaultRemediationAction,
  KeyVaultResourceItem,
} from "@/types/azureKeyVault.types";

/**
 * Scrollbar horizontal siempre visible. En macOS los scrollbars son overlay y
 * desaparecen al no scrollear, así que el usuario no descubre que la tabla
 * continúa a la derecha.
 */
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

/** Compacta volúmenes grandes: 2 400 000 → "2.4M". */
const formatOps = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
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

function SkuBadge({ sku }: { sku: KeyVaultResourceItem["skuName"] }) {
  const t = useTranslations("KeyVaultPanel");
  const map = {
    Standard: { label: "Standard", cls: "border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300" },
    Premium: { label: "Premium", cls: "border-blue-400 dark:border-blue-600 text-[#2563EB] dark:text-blue-400" },
    Managed_HSM: {
      label: "Managed HSM",
      cls: "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400",
    },
  } as const;
  const cfg = map[sku];
  return (
    <span
      className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 whitespace-nowrap ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

// ─── Drawer de Recursos Vinculados (z-50) ───
function LinkedConsumersDrawer({
  vault,
  onClose,
}: {
  vault: KeyVaultResourceItem | null;
  onClose: () => void;
}) {
  const t = useTranslations("KeyVaultPanel");
  if (!vault) return null;

  const withTelemetry = vault.linkedConsumers.some((c) => c.apiHitsMTD > 0);
  const sorted = [...vault.linkedConsumers].sort((a, b) => b.apiHitsMTD - a.apiHitsMTD);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-2xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl overflow-y-auto z-50"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconKey className="w-5 h-5 text-[#0078D4] shrink-0" stroke={1.5} />
              <span className="truncate">{vault.name}</span>
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 truncate">
              {vault.resourceGroup} · {vault.subscriptionName} · {vault.location}
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

        <div className="p-5 space-y-5">
          {/* Postura de la bóveda */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Transacciones MTD</div>
              <div className="text-lg font-extrabold text-[#1B2A41] dark:text-slate-100">
                {formatOps(vault.totalApiHitsMTD)}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Throttling (429)</div>
              <div
                className={`text-lg font-extrabold ${
                  vault.throttledHits429 > 0
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-[#1B2A41] dark:text-slate-100"
                }`}
              >
                {vault.throttledHits429}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">Latencia media</div>
              <div className="text-lg font-extrabold text-[#1B2A41] dark:text-slate-100">
                {vault.avgLatencyMs > 0 ? `${vault.avgLatencyMs} ms` : "—"}
              </div>
            </div>
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
              <div className="text-[10px] text-slate-500 dark:text-slate-400">{t("monthlyCost")}</div>
              <div className="text-lg font-extrabold text-[#1B2A41] dark:text-slate-100">
                {formatCurrency(vault.monthlyCostUSD)}
              </div>
            </div>
          </div>

          {/* Desglose del costo, para que la cifra sea auditable */}
          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
            <h3 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 mb-2 flex items-center gap-1.5">
              {t("costBreakdown")}
              <InfoTooltip content={t("costBreakdownTooltip")} />
            </h3>
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-600 dark:text-slate-400">Transacciones API</span>
                <span className="font-semibold text-[#1B2A41] dark:text-slate-200">
                  {formatCurrency(vault.transactionCostUSD)}
                </span>
              </div>
              {vault.hsmKeyCostUSD > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">
                    Claves HSM ({vault.hsmKeysCount})
                  </span>
                  <span className="font-semibold text-[#1B2A41] dark:text-slate-200">
                    {formatCurrency(vault.hsmKeyCostUSD)}
                  </span>
                </div>
              )}
              {vault.managedHsmPoolCostUSD > 0 && (
                <div className="flex justify-between">
                  <span className="text-amber-700 dark:text-amber-400 font-semibold">Pool Managed HSM</span>
                  <span className="font-bold text-amber-700 dark:text-amber-400">
                    {formatCurrency(vault.managedHsmPoolCostUSD)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Postura de seguridad */}
          <div className="flex flex-wrap gap-1.5">
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 flex items-center gap-1 ${
                vault.rbacEnabled
                  ? "border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
                  : "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400"
              }`}
            >
              {vault.rbacEnabled ? <IconLock className="w-3 h-3" /> : <IconLockOpen className="w-3 h-3" />}
              {vault.rbacEnabled ? "Azure RBAC" : "Access Policies"}
            </span>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 ${
                vault.publicNetworkAccess === "Disabled"
                  ? "border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
                  : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
              }`}
            >
              Red pública: {vault.publicNetworkAccess === "Disabled" ? "deshabilitada" : vault.publicNetworkAccess}
            </span>
            {vault.privateEndpointsCount > 0 && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300 bg-white dark:bg-slate-900">
                {vault.privateEndpointsCount} Private Endpoint(s)
              </span>
            )}
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-md border bg-white dark:bg-slate-900 ${
                vault.purgeProtectionEnabled
                  ? "border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
                  : "border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"
              }`}
            >
              Purge protection: {vault.purgeProtectionEnabled ? "activa" : "inactiva"}
            </span>
          </div>

          {/* Consumidores */}
          <div>
            <h3 className="text-xs font-bold text-[#1B2A41] dark:text-slate-100 mb-2 flex items-center gap-1.5">
              {t("linkedResources", { count: vault.linkedConsumers.length })}
              <InfoTooltip content={t("consumersTooltip")} />
            </h3>
            {vault.linkedConsumers.length === 0 ? (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 py-4 text-center">
                {t("noConsumers1")}
                {t("noConsumers2")}
              </p>
            ) : (
              <div className="space-y-2">
                {sorted.map((c) => (
                  <div
                    key={c.resourceId}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <span className="block text-xs font-bold text-[#1B2A41] dark:text-slate-100 truncate">
                        {c.resourceName}
                      </span>
                      <span className="block text-[10px] text-slate-500 dark:text-slate-400 truncate">
                        {c.resourceGroup} · {c.resourceType.split("/").pop()}
                      </span>
                      <span className="block text-[10px] text-[#0054A6] dark:text-blue-300 mt-0.5 truncate">
                        {c.accessMethod}
                      </span>
                    </div>
                    {c.apiHitsMTD > 0 && (
                      <div className="text-right shrink-0">
                        <div className="text-xs font-extrabold text-[#1B2A41] dark:text-slate-100">
                          {formatOps(c.apiHitsMTD)}
                        </div>
                        <div className="text-[10px] text-slate-400">ops MTD</div>
                      </div>
                    )}
                  </div>
                ))}
                {!withTelemetry && vault.linkedConsumers.length > 0 && (
                  <p className="text-[10px] text-slate-400 leading-relaxed pt-1">
                    {t("noVolumeAttribution")}{" "}
                    <code>AuditEvent</code> {t("auditEventNote")}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de Remediación (z-50) ───
function KeyVaultRemediationModal({
  action,
  onClose,
}: {
  action: KeyVaultRemediationAction | null;
  onClose: () => void;
}) {
  const t = useTranslations("KeyVaultPanel");
  const [copied, setCopied] = useState<"cli" | "ps" | null>(null);
  if (!action) return null;

  const cmd = buildKeyVaultRemediationCommand(action);
  const isDestructive = action.category === "DOWNGRADE_MANAGED_HSM";
  const copy = (text: string, which: "cli" | "ps") => {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl shadow-2xl p-6 relative z-50 max-h-[85vh] overflow-y-auto"
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
            <h2 className="text-base font-bold text-[#1B2A41] dark:text-slate-100">{action.title}</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{action.description}</p>
          </div>
        </div>

        {action.estimatedSavingsUSD > 0 ? (
          <div className="mb-4 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
            <span className="text-xs text-slate-600 dark:text-slate-400">{t("estimatedMonthlySavings")} </span>
            <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
              {formatCurrency(action.estimatedSavingsUSD)}
            </span>
          </div>
        ) : (
          <div className="mb-4 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
            <span className="text-xs text-slate-600 dark:text-slate-400">
              {t.rich("postureAction", { b: (c) => <span className="font-bold">{c}</span> })}
            </span>
          </div>
        )}

        {isDestructive && (
          <div className="mb-4 p-3 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 flex items-start gap-2">
            <IconAlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" stroke={2} />
            <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
              {t.rich("hsmIrreversibleNote", { b: (c) => <span className="font-bold">{c}</span> })}
            </p>
          </div>
        )}

        {([
          ["Azure CLI", cmd.cli, "cli"],
          ["PowerShell", cmd.powershell, "ps"],
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
          {t("placeholdersNote")}
        </p>
      </div>
    </div>
  );
}

// ─── Componente Principal ───
export default function KeyVaultPanel() {
  const t = useTranslations("KeyVaultPanel");
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

  const apiUrl = `/api/intelligence/security/key-vault?tenantId=${encodeURIComponent(tenantId)}`;
  const { data, error, isValidating, mutate } = useSWR<KeyVaultPayload>(apiUrl, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSku, setSelectedSku] = useState("ALL");
  const [selectedAuth, setSelectedAuth] = useState("ALL");
  const [selectedSub, setSelectedSub] = useState("ALL");
  const [selectedRg, setSelectedRg] = useState("ALL");

  const [drawerVault, setDrawerVault] = useState<KeyVaultResourceItem | null>(null);
  const [activeRemediation, setActiveRemediation] = useState<KeyVaultRemediationAction | null>(null);

  const vaultsList = useMemo(() => data?.vaults || [], [data?.vaults]);

  const subscriptions = useMemo(() => {
    const map = new Map<string, string>();
    vaultsList.forEach((v) => map.set(v.subscriptionId, v.subscriptionName || v.subscriptionId));
    return Array.from(map.entries());
  }, [vaultsList]);

  const resourceGroups = useMemo(
    () => Array.from(new Set(vaultsList.map((v) => v.resourceGroup).filter(Boolean))).sort(),
    [vaultsList]
  );

  const filteredVaults = useMemo(() => {
    return vaultsList
      .filter((v) => {
        if (searchTerm) {
          const term = searchTerm.toLowerCase();
          const hit =
            v.name.toLowerCase().includes(term) ||
            v.resourceGroup.toLowerCase().includes(term) ||
            (v.subscriptionName || "").toLowerCase().includes(term) ||
            v.linkedConsumers.some((c) => c.resourceName.toLowerCase().includes(term));
          if (!hit) return false;
        }
        if (selectedSku !== "ALL" && v.skuName !== selectedSku) return false;
        if (selectedAuth !== "ALL" && v.authModel !== selectedAuth) return false;
        if (selectedSub !== "ALL" && v.subscriptionId !== selectedSub) return false;
        if (selectedRg !== "ALL" && v.resourceGroup !== selectedRg) return false;
        return true;
      })
      .sort((a, b) => b.monthlyCostUSD - a.monthlyCostUSD);
  }, [vaultsList, searchTerm, selectedSku, selectedAuth, selectedSub, selectedRg]);

  const {
    paged: paginatedVaults,
    page,
    totalPages,
    pageSize,
    setPage,
    setPageSize,
    total,
  } = usePagination(filteredVaults, 15);

  const handleExportCSV = () => {
    if (filteredVaults.length === 0) return;
    const headers = [
      "Vault",
      "SKU",
      "Region",
      "Resource Group",
      "Subscription",
      "Auth Model",
      "Public Network Access",
      "Private Endpoints",
      "Secrets",
      "Keys",
      "Certificates",
      "Expired Objects",
      "Linked Consumers",
      "API Hits MTD",
      "Throttled 429",
      "Avg Latency ms",
      "Transaction Cost USD",
      "HSM Key Cost USD",
      "Managed HSM Pool Cost USD",
      "Total Monthly Cost USD",
    ];
    const rows = filteredVaults.map((v) => [
      `"${v.name}"`,
      `"${v.skuName}"`,
      `"${v.location}"`,
      `"${v.resourceGroup}"`,
      `"${v.subscriptionName}"`,
      `"${v.authModel}"`,
      `"${v.publicNetworkAccess}"`,
      v.privateEndpointsCount,
      v.secretsCount,
      v.keysCount,
      v.certificatesCount,
      v.expiredObjectsCount,
      v.linkedConsumers.length,
      v.totalApiHitsMTD,
      v.throttledHits429,
      v.avgLatencyMs,
      v.transactionCostUSD.toFixed(2),
      v.hsmKeyCostUSD.toFixed(2),
      v.managedHsmPoolCostUSD.toFixed(2),
      v.monthlyCostUSD.toFixed(2),
    ]);
    const csv = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `azure-key-vault-${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const summary = data?.summary || {
    totalMonthlyCostUSD: 0,
    projectedMonthEndCostUSD: 0,
    totalVaultsCount: 0,
    standardCount: 0,
    premiumCount: 0,
    managedHsmCount: 0,
    totalApiTransactionsMTD: 0,
    totalThrottled429: 0,
    totalStoredObjects: 0,
    totalSecrets: 0,
    totalKeys: 0,
    totalCertificates: 0,
    totalExpiredObjects: 0,
    accessPolicyVaultsCount: 0,
    potentialSavingsUSD: 0,
    breakdownByObjectType: [],
  };

  const apiTrend = data?.apiTrend || [];

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">
      {/* ─── Encabezado ─── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              <IconKey className="w-6 h-6 text-[#0078D4]" stroke={1.5} />
              <span>{t("boardTitle")}</span>
              <InfoTooltip
                content={t("boardTooltip")}
                position="bottom"
                align="left"
              />
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-900 text-[#0054A6]">
              {data?.source === "live" ? "Live Resource Graph + Azure Monitor" : "Demo Sandbox"}
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

      {/* ─── 4 Tarjetas KPI ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>{t("kpiTotalCost")}</span>
              <InfoTooltip content={t("kpiTotalCostTooltip")} />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {formatCurrency(summary.totalMonthlyCostUSD)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t("eomProjectionLabel", { amount: formatCurrency(summary.projectedMonthEndCostUSD) })}
            </div>
          </div>
          <IconCash className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>{t("kpiVaults")}</span>
              <InfoTooltip content={t("kpiVaultsTooltip")} />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {summary.totalVaultsCount}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap gap-1.5">
              <span className="text-[#0054A6] dark:text-blue-300 font-semibold">{summary.standardCount} Std</span>
              <span className="text-[#2563EB] dark:text-blue-400 font-semibold">{summary.premiumCount} Prem</span>
              {summary.managedHsmCount > 0 && (
                <span className="text-amber-600 dark:text-amber-400 font-semibold">
                  {summary.managedHsmCount} HSM
                </span>
              )}
            </div>
          </div>
          <IconKey className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Transacciones API MTD</span>
              <InfoTooltip content={t("kpiOpsTooltip")} />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100">
              {formatOps(summary.totalApiTransactionsMTD)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.totalThrottled429 > 0 ? (
                <span className="text-amber-600 dark:text-amber-400 font-semibold">
                  {t("throttled429", { n: summary.totalThrottled429 })}
                </span>
              ) : (
                t("noThrottling")
              )}
            </div>
          </div>
          <IconRepeat className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <span>Objetos Almacenados</span>
              <InfoTooltip content={t("kpiObjectsTooltip")} />
            </div>
            <div className="text-2xl font-extrabold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
              {summary.totalStoredObjects}
              {summary.totalExpiredObjects > 0 && (
                <IconAlertTriangle className="w-4 h-4 text-amber-500" stroke={2} />
              )}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {summary.totalSecrets} secretos · {summary.totalKeys} claves · {summary.totalCertificates} certs
              {summary.totalExpiredObjects > 0 && (
                <span className="block text-amber-600 dark:text-amber-400 font-semibold">
                  {summary.totalExpiredObjects} vencido(s)
                </span>
              )}
            </div>
          </div>
          <IconShieldLock className="w-8 h-8 text-[#0078D4]" stroke={1.5} />
        </div>
      </div>

      {/* ─── Fila 1: Distribución de operaciones + Evolución de API ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mb-3 flex items-center gap-1.5">
            {t("opsByObjectType")}
            <InfoTooltip content={t("opsByObjectTypeTooltip")} />
          </h3>
          {summary.breakdownByObjectType.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-xs text-slate-400">
              {t("noTransactions")}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={224}>
              <PieChart>
                <Pie
                  data={summary.breakdownByObjectType}
                  dataKey="operationsCount"
                  nameKey="label"
                  innerRadius={52}
                  outerRadius={82}
                  paddingAngle={2}
                >
                  {summary.breakdownByObjectType.map((entry) => (
                    <Cell key={entry.objectType} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip formatter={(v) => `${Number(v ?? 0).toLocaleString("es-AR")} ops`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100 mb-3 flex items-center gap-1.5">
            <IconChartAreaLine className="w-4 h-4 text-[#0078D4]" stroke={1.5} />
            {t("apiCallsLatency")}
            <InfoTooltip content={t("apiCallsLatencyTooltip")} />
          </h3>
          {apiTrend.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-xs text-slate-400">
              {t("noHistory")}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={224}>
              <AreaChart data={apiTrend}>
                <defs>
                  <linearGradient id="kvApiGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0078D4" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#0078D4" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tickFormatter={(v) => formatOps(Number(v))}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  tickFormatter={(v) => `${v}ms`}
                />
                <RechartsTooltip
                  formatter={(v, name) =>
                    name === "avgLatencyMs"
                      ? `${Number(v ?? 0)} ms`
                      : `${Number(v ?? 0).toLocaleString("es-AR")} ops`
                  }
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="apiHits"
                  stroke="#0078D4"
                  strokeWidth={2}
                  fill="url(#kvApiGradient)"
                />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="avgLatencyMs"
                  stroke="#38BDF8"
                  strokeWidth={1.5}
                  fill="none"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ─── Filtros ─── */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2 relative">
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
            value={selectedSku}
            onChange={(e) => setSelectedSku(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">{t("skuAll")}</option>
            <option value="Standard">Standard</option>
            <option value="Premium">Premium</option>
            <option value="Managed_HSM">Managed HSM</option>
          </select>

          <select
            value={selectedAuth}
            onChange={(e) => setSelectedAuth(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">{t("authAll")}</option>
            <option value="AzureRBAC">Azure RBAC</option>
            <option value="AccessPolicies">Access Policies</option>
          </select>

          <select
            value={selectedSub}
            onChange={(e) => setSelectedSub(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">{t("allSubscriptions")}</option>
            {subscriptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>

          <select
            value={selectedRg}
            onChange={(e) => setSelectedRg(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#0054A6]"
          >
            <option value="ALL">{t("allRgs")}</option>
            {resourceGroups.map((rg) => (
              <option key={rg} value={rg}>
                {rg}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ─── Fila 2: Tabla (scrollbar visible en macOS) ─── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5">
          <h3 className="text-sm font-bold text-[#1B2A41] dark:text-slate-100">
            {t("tableTitle")}
          </h3>
          <InfoTooltip content={t("tableTooltip")} />
          <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400">{t("vaultCount", { count: total })}</span>
        </div>

        <div className={VISIBLE_SCROLLBAR}>
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400">
              <tr>
                <ResizableTh minWidth={220}>{t("colVault")}</ResizableTh>
                <ResizableTh minWidth={120}>SKU</ResizableTh>
                <ResizableTh minWidth={110}>{t("colRegion")}</ResizableTh>
                <ResizableTh minWidth={170}>{t("colSubscription")}</ResizableTh>
                <ResizableTh minWidth={170}>{t("colLinked")}</ResizableTh>
                <ResizableTh minWidth={150}>{t("colObjects")}</ResizableTh>
                <ResizableTh minWidth={130}>Transacciones MTD</ResizableTh>
                <ResizableTh minWidth={120}>{t("colMonthlyCost")}</ResizableTh>
                <ResizableTh minWidth={240}>Acciones</ResizableTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {paginatedVaults.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500 dark:text-slate-400">
                    <IconKey className="w-7 h-7 text-[#0078D4] mx-auto mb-2" stroke={1.5} />
                    <p className="text-xs font-medium">
                      {vaultsList.length === 0
                        ? "Azure no reporta Key Vaults en las suscripciones visibles."
                        : "Ninguna bóveda coincide con los filtros aplicados."}
                    </p>
                  </td>
                </tr>
              ) : (
                paginatedVaults.map((v: KeyVaultResourceItem) => (
                  <tr key={v.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => setDrawerVault(v)}
                        className="flex items-start gap-2 text-left cursor-pointer group"
                      >
                        <IconKey className="w-4 h-4 text-[#0078D4] shrink-0 mt-0.5" stroke={1.5} />
                        <span className="min-w-[120px] max-w-[240px]">
                          <span className="block font-semibold text-[#1B2A41] dark:text-slate-100 group-hover:text-[#0054A6] truncate">
                            {v.name}
                          </span>
                          <span className="flex items-center gap-1 mt-0.5">
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded border bg-white dark:bg-slate-900 ${
                                v.rbacEnabled
                                  ? "border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
                                  : "border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400"
                              }`}
                            >
                              {v.rbacEnabled ? "RBAC" : "Policies"}
                            </span>
                            {v.hasFindings && (
                              <IconAlertTriangle
                                className="w-3.5 h-3.5 text-amber-500"
                                stroke={2}
                                title={v.findingReason}
                              />
                            )}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      <SkuBadge sku={v.skuName} />
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">{v.location}</td>
                    <td
                      className="px-3 py-2.5 text-slate-600 dark:text-slate-400 min-w-[120px] max-w-[240px] truncate"
                      title={v.subscriptionName}
                    >
                      {v.subscriptionName}
                    </td>
                    <td className="px-3 py-2.5">
                      {v.linkedConsumers.length === 0 ? (
                        <span className="text-slate-400">{t("noConsumersDetected")}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800 text-[#0054A6] dark:text-blue-300 bg-white dark:bg-slate-900">
                          <IconPlugConnected className="w-3 h-3" stroke={2} />
                          {t("resourceCount", { count: v.linkedConsumers.length })}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-slate-700 dark:text-slate-300">
                        {v.secretsCount} / {v.keysCount} / {v.certificatesCount}
                      </span>
                      <span className="block text-[10px] text-slate-400">sec / claves / certs</span>
                      {v.expiredObjectsCount > 0 && (
                        <span className="block text-[10px] text-amber-600 dark:text-amber-400 font-semibold">
                          {v.expiredObjectsCount} vencido(s)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-semibold text-[#1B2A41] dark:text-slate-100">
                        {formatOps(v.totalApiHitsMTD)} ops
                      </span>
                      {v.throttledHits429 > 0 && (
                        <span className="block text-[10px] text-amber-600 dark:text-amber-400 font-semibold">
                          {v.throttledHits429} × 429
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-bold text-[#1B2A41] dark:text-slate-100 whitespace-nowrap">
                      {formatCurrency(v.monthlyCostUSD)}
                      {v.managedHsmPoolCostUSD > 0 && (
                        <span className="block text-[10px] text-amber-600 dark:text-amber-400 font-normal">
                          pool HSM
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          onClick={() => setDrawerVault(v)}
                          className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition cursor-pointer whitespace-nowrap flex items-center gap-1"
                        >
                          <IconSparkles size={13} stroke={1.5} className="text-[#0054A6]" />
                          {t("viewLinked")}
                        </button>
                        <button
                          onClick={() =>
                            setActiveRemediation({
                              id: `audit-manual-${v.id}`,
                              vaultId: v.id,
                              vaultName: v.name,
                              title: `Auditar objetos de ${v.name}`,
                              description: `${v.secretsCount} secretos, ${v.keysCount} claves y ${v.certificatesCount} certificados${
                                v.expiredObjectsCount > 0 ? `, con ${v.expiredObjectsCount} vencido(s)` : ""
                              }.`,
                              category: "PURGE_EXPIRED_OBJECTS",
                              estimatedSavingsUSD: 0,
                              confidence: "MEDIUM",
                              actionType: "AUDIT_AND_PURGE",
                            })
                          }
                          className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-[#00AEEF] bg-white dark:bg-slate-900 text-[#00AEEF] hover:bg-sky-50/50 dark:hover:bg-sky-950/40 transition cursor-pointer whitespace-nowrap flex items-center gap-1"
                        >
                          <IconSparkles size={13} stroke={1.5} className="text-[#00AEEF]" />
                          Auditar Objetos
                        </button>
                        {v.totalApiHitsMTD > 1_000_000 && (
                          <button
                            onClick={() =>
                              setActiveRemediation({
                                id: `polling-manual-${v.id}`,
                                vaultId: v.id,
                                vaultName: v.name,
                                title: `Optimizar polling en ${v.name}`,
                                description: `${v.totalApiHitsMTD.toLocaleString("es-AR")} operaciones MTD${
                                  v.throttledHits429 > 0 ? ` y ${v.throttledHits429} respuestas 429` : ""
                                }.`,
                                category: "POLLING_CACHE_OPTIMIZATION",
                                estimatedSavingsUSD: 0,
                                confidence: "HIGH",
                                actionType: "IMPLEMENT_CLIENT_CACHE",
                              })
                            }
                            className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer whitespace-nowrap"
                          >
                            Optimizar Polling
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
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
              {formatCurrency(summary.potentialSavingsUSD)}/mes
            </span>
            {summary.accessPolicyVaultsCount > 0 && (
              <>
                {" · "}
                <span className="text-amber-600 dark:text-amber-400 font-semibold">
                  {t("vaultsWithoutRbac", { count: summary.accessPolicyVaultsCount })}
                </span>
              </>
            )}
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
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
                  <span className="text-[10px] text-slate-400 font-medium">Confianza: {action.confidence}</span>
                  <button
                    onClick={() => setActiveRemediation(action)}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#0054A6] bg-white dark:bg-slate-900 text-[#0054A6] hover:bg-blue-50/50 dark:hover:bg-blue-950/40 transition flex items-center gap-1 cursor-pointer"
                  >
                    <IconTerminal2 className="w-3.5 h-3.5" />
                    Remediar
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

      {/* ─── Capas superpuestas (z-50) ─── */}
      <LinkedConsumersDrawer vault={drawerVault} onClose={() => setDrawerVault(null)} />
      <KeyVaultRemediationModal action={activeRemediation} onClose={() => setActiveRemediation(null)} />
    </div>
  );
}
