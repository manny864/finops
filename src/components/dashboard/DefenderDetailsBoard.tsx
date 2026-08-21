"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { errorMessage } from '@/lib/apiErrors';

interface DefenderPlanDetail {
  planId: string;
  planName: string;
  name: string;
  planType: "Servers Plan 1" | "Servers Plan 2" | "Storage" | "Containers" | "SQL" | "CSPM" | "Other";
  pricingTier: "Free" | "Standard";
  subscriptionId: string;
  subscriptionName: string;
  estimatedMonthlyCost: number;
  resourcesCovered: number;
  protectionStatus: "Full" | "Partial" | "None";
  lastUpdated: string;
  recommendations: string[];
}

interface DefenderSummary {
  totalEstimatedMonthlyCost: number;
  totalResourcesCovered: number;
  defenderTypesEnabled: string[];
  fullyCovered: number;
  partiallyCovered: number;
  notCovered: number;
}

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function DefenderDetailsBoard() {
  const t = useTranslations("Defender");
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const [details, setDetails] = useState<DefenderPlanDetail[]>([]);
  const [summary, setSummary] = useState<DefenderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const isMock = isMockTenant(selectedTenant.id);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers: HeadersInit = isMock
        ? {}
        : { Authorization: `Bearer ${await getFreshIdToken(instance, accounts[0])}` };
      const res = await fetch(`/api/intelligence/defender/details?tenantId=${encodeURIComponent(selectedTenant.id)}`, { headers });
      if (!res.ok) throw new Error(t("toast_load_error"));
      const json = await res.json();
      setDetails(json.details || []);
      setSummary(json.summary || null);
    } catch (e) {
      toast.error(errorMessage(e) || t("toast_load_error"));
    } finally {
      setLoading(false);
    }
  }, [selectedTenant.id, instance, accounts, t, isMock]);

  useEffect(() => {
    if (selectedTenant.id !== "default" && (isMock || accounts.length > 0)) {
      void load();
    }
  }, [selectedTenant.id, accounts.length, load, isMock]);

  const togglePlan = useCallback(
    async (plan: DefenderPlanDetail) => {
      if (isMock) return;
      const key = `${plan.subscriptionId}/${plan.planName}`;
      setTogglingKey(key);
      try {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        const nextTier = plan.pricingTier === "Standard" ? "Free" : "Standard";
        const res = await fetch("/api/intelligence/defender", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            tenantId: selectedTenant.id,
            subscriptionId: plan.subscriptionId,
            planName: plan.planName,
            pricingTier: nextTier,
          }),
        });
        if (!res.ok) throw new Error(t("toast_update_error"));
        toast.success(t("toast_updated"));
        await load();
      } catch (e) {
        toast.error(errorMessage(e) || t("toast_update_error"));
      } finally {
        setTogglingKey(null);
      }
    },
    [isMock, instance, accounts, selectedTenant.id, t, load]
  );

  const getStatusColor = (status: string) => {
    if (status === "Full") return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    if (status === "Partial") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  };

  if (selectedTenant.id === "default") return null;

  if (loading) {
    return (
      <div className="p-6 w-full flex items-center justify-center min-h-[400px]">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-brand-soft border-t-brand-deep rounded-full animate-spin mb-4"></div>
          <p className="text-gray-500 font-semibold">{t("loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 w-full space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">Costo mensual</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{fmt.format(summary?.totalEstimatedMonthlyCost || 0)}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">Recursos protegidos</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{summary?.totalResourcesCovered || 0}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">Cobertura completa</p>
          <p className="text-lg font-bold text-green-600 dark:text-green-400">{summary?.fullyCovered || 0}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">Sin cobertura</p>
          <p className="text-lg font-bold text-red-600 dark:text-red-400">{summary?.notCovered || 0}</p>
        </div>
      </div>

      {details.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
          No hay planes de Defender habilitados.
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-slate-700">
                <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">Plan</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">Suscripción</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-300">Tier</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-300">Recursos</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-300">Costo</th>
                <th className="px-3 py-2 text-center font-semibold text-gray-600 dark:text-gray-300">Estado</th>
                {!isMock && <th className="px-3 py-2 text-right font-semibold text-gray-600 dark:text-gray-300">Acción</th>}
              </tr>
            </thead>
            <tbody>
              {details.map((plan) => {
                const key = `${plan.subscriptionId}/${plan.planName}`;
                return (
                  <tr key={plan.planId} className="border-b border-gray-100 dark:border-slate-800">
                    <td className="px-3 py-2 text-gray-900 dark:text-white">{plan.planType}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300 break-all">{plan.subscriptionName || plan.subscriptionId}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-1 rounded ${plan.pricingTier === "Standard" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-gray-300"}`}>
                        {plan.pricingTier}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-gray-900 dark:text-white">{plan.resourcesCovered}</td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-white">{fmt.format(plan.estimatedMonthlyCost)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-xs px-2 py-1 rounded ${getStatusColor(plan.protectionStatus)}`}>{plan.protectionStatus}</span>
                    </td>
                    {!isMock && (
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => void togglePlan(plan)}
                          disabled={togglingKey === key}
                          className="text-xs font-semibold px-2 py-1 rounded border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
                        >
                          {togglingKey === key ? t("toggling") : plan.pricingTier === "Standard" ? t("action_disable") : t("action_enable")}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
