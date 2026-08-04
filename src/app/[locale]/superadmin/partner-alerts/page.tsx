"use client";

import React, { useEffect, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, BellRing, CheckCircle2, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { isSuperAdmin } from "@/lib/authGuard";
import { getFreshIdToken } from "@/lib/msalToken";

type PartnerAlert = {
  tenantId: string;
  tenantName: string;
  tier: string | null;
  status: "APPROVED" | "LINKED" | "FAILED" | "DECLINED";
  detail: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  severity: "success" | "warning" | "error";
  isRecent: boolean;
};

type PartnerAlertsResponse = {
  success: boolean;
  summary: {
    linked: number;
    approvedPending: number;
    failed: number;
    recent7d: number;
  };
  alerts: PartnerAlert[];
  schemaReady: boolean;
};

const STATUS_STYLE: Record<string, string> = {
  LINKED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  APPROVED: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  FAILED: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  DECLINED: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export default function SuperAdminPartnerAlertsPage() {
  const t = useTranslations("SuperAdminPartnerAlerts");
  const { accounts, instance } = useMsal();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PartnerAlertsResponse | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const idToken = await getFreshIdToken(instance, accounts[0]);
      const res = await fetch("/api/superadmin/partner-alerts", {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || t("loadError"));
      }
      setData(json);
    } catch (error: any) {
      toast.error(error?.message || t("loadError"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accounts.length === 0) return;
    if (!isSuperAdmin(accounts[0].username)) {
      toast.error(t("noAccess"));
      router.replace("/");
      return;
    }
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length]);

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center text-slate-500">
        <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
        {t("emptyError")}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold text-slate-900 dark:text-slate-100">
            <BellRing className="h-6 w-6 text-brand-deep" />
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{t("subtitle")}</p>
        </div>
        <button
          onClick={loadData}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm hover:border-brand hover:text-brand dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <RefreshCw className="h-4 w-4" />
          {t("refresh")}
        </button>
      </div>

      {!data.schemaReady && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-sm">{t("schemaNotReady")}</p>
        </div>
      )}

      {data.summary.recent7d > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-sm">{t("recentAlert", { count: data.summary.recent7d })}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t("linked")}</p>
          <p className="mt-2 text-lg font-extrabold text-slate-800 dark:text-slate-100">{data.summary.linked}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t("approvedPending")}</p>
          <p className="mt-2 text-lg font-extrabold text-slate-800 dark:text-slate-100">{data.summary.approvedPending}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t("failed")}</p>
          <p className="mt-2 text-lg font-extrabold text-slate-800 dark:text-slate-100">{data.summary.failed}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t("recent7d")}</p>
          <p className="mt-2 text-lg font-extrabold text-slate-800 dark:text-slate-100">{data.summary.recent7d}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-gray-100 p-4 dark:border-slate-800">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{t("tableTitle")}</h2>
        </div>
        <div className="max-h-[620px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-gray-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/70">
              <tr>
                <th className="px-4 py-3">{t("tenant")}</th>
                <th className="px-4 py-3">{t("status")}</th>
                <th className="px-4 py-3">{t("approvedAt")}</th>
                <th className="px-4 py-3">{t("approvedBy")}</th>
                <th className="px-4 py-3">{t("detail")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {data.alerts.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-xs text-slate-500" colSpan={5}>
                    {t("empty")}
                  </td>
                </tr>
              )}
              {data.alerts.map((alert) => (
                <tr key={`${alert.tenantId}-${alert.status}-${alert.approvedAt || "na"}`}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-700 dark:text-slate-200">{alert.tenantName}</div>
                    <div className="text-xs text-slate-500">{alert.tenantId} {alert.tier ? `· ${alert.tier}` : ""}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${STATUS_STYLE[alert.status]}`}>
                      {alert.status === "LINKED" ? <CheckCircle2 className="h-3 w-3" /> : alert.status === "FAILED" ? <XCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                      {t(`status_${alert.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {alert.approvedAt ? new Date(alert.approvedAt).toLocaleString() : "-"}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{alert.approvedBy || "-"}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{alert.detail || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
