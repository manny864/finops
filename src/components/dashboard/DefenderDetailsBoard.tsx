"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Shield, AlertCircle, CheckCircle, ChevronDown } from "lucide-react";

interface DefenderPlanDetail {
  planId: string;
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const idToken = await getFreshIdToken(instance, accounts[0]);
      const res = await fetch(`/api/intelligence/defender/details?tenantId=${encodeURIComponent(selectedTenant.id)}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(t("toast_load_error"));
      const json = await res.json();
      setDetails(json.details || []);
      setSummary(json.summary || null);
    } catch (e: any) {
      toast.error(e.message || t("toast_load_error"));
    } finally {
      setLoading(false);
    }
  }, [selectedTenant.id, instance, accounts, t]);

  useEffect(() => {
    if (selectedTenant.id !== "default" && accounts.length > 0) {
      void load();
    }
  }, [selectedTenant.id, accounts.length, load]);

  const getStatusColor = (status: string) => {
    if (status === "Full") return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    if (status === "Partial") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  };

  const getStatusIcon = (status: string) => {
    if (status === "Full") return <CheckCircle className="w-4 h-4" />;
    if (status === "Partial") return <AlertCircle className="w-4 h-4" />;
    return <AlertCircle className="w-4 h-4" />;
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
    <div className="p-6 w-full animate-in fade-in duration-500 space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Total Costo Mensual</h3>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{fmt.format(summary?.totalEstimatedMonthlyCost || 0)}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Recursos Protegidos</h3>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{summary?.totalResourcesCovered || 0}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Cobertura Completa</h3>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{summary?.fullyCovered || 0}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Sin Cobertura</h3>
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">{summary?.notCovered || 0}</p>
        </div>
      </div>

      {/* Defender Plans Grid */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Planes de Defender Habilitados</h2>

        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          {details.map((plan) => (
            <div
              key={plan.planId}
              className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 overflow-hidden hover:shadow-md transition-shadow"
            >
              {/* Header */}
              <div
                className="p-4 cursor-pointer flex items-start justify-between bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-800 dark:to-slate-900 border-b border-gray-200 dark:border-slate-700"
                onClick={() => setExpandedId(expandedId === plan.planId ? null : plan.planId)}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Shield className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <h3 className="font-semibold text-gray-900 dark:text-white">{plan.name}</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-1 rounded">
                      {plan.planType}
                    </span>
                    <span
                      className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${getStatusColor(
                        plan.protectionStatus
                      )}`}
                    >
                      {getStatusIcon(plan.protectionStatus)}
                      {plan.protectionStatus}
                    </span>
                  </div>
                </div>
                <ChevronDown
                  className={`w-5 h-5 text-gray-400 transition-transform ${expandedId === plan.planId ? "rotate-180" : ""}`}
                />
              </div>

              {/* Summary row */}
              <div className="px-4 py-3 flex justify-between items-center border-b border-gray-100 dark:border-slate-800">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  <span className="font-semibold">{plan.resourcesCovered}</span> recurso{plan.resourcesCovered !== 1 ? "s" : ""} |{" "}
                  <span className="font-semibold text-gray-900 dark:text-white">{fmt.format(plan.estimatedMonthlyCost)}</span>
                </div>
                <span className={`text-xs font-semibold px-2 py-1 rounded ${plan.pricingTier === "Standard" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-gray-300"}`}>
                  {plan.pricingTier}
                </span>
              </div>

              {/* Expandable details */}
              {expandedId === plan.planId && (
                <div className="px-4 py-3 space-y-3 bg-gray-50 dark:bg-slate-800/50">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">Suscripción:</span>
                      <p className="font-mono text-xs text-gray-900 dark:text-white break-all">{plan.subscriptionName}</p>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">Estado:</span>
                      <p className="text-gray-900 dark:text-white font-semibold">{plan.protectionStatus}</p>
                    </div>
                  </div>

                  {/* Recommendations */}
                  {plan.recommendations.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-2">
                        Recomendaciones
                      </h4>
                      <ul className="space-y-1">
                        {plan.recommendations.map((rec, idx) => (
                          <li key={idx} className="text-xs text-gray-600 dark:text-gray-400 flex gap-2">
                            <span className="text-blue-500 flex-shrink-0">•</span>
                            <span>{rec}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-200 dark:border-slate-700">
                    Última actualización: {new Date(plan.lastUpdated).toLocaleString()}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {details.length === 0 && (
          <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800">
            <Shield className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400">No hay planes de Defender habilitados</p>
          </div>
        )}
      </div>

      {/* Plan Comparison Table */}
      {details.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Resumen de Costos y Cobertura</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Defender Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Tier</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300">Recurso Cubiertos</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300">Costo Mensual</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300">Estado</th>
                </tr>
              </thead>
              <tbody>
                {details.map((plan) => (
                  <tr key={plan.planId} className="border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white">{plan.planType}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`px-2 py-1 text-xs font-semibold rounded ${plan.pricingTier === "Standard" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" : "bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-gray-300"}`}>
                        {plan.pricingTier}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white font-semibold">{plan.resourcesCovered}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white font-bold text-brand-deep">{fmt.format(plan.estimatedMonthlyCost)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1 font-semibold ${getStatusColor(plan.protectionStatus)}`}>
                        {getStatusIcon(plan.protectionStatus)}
                        {plan.protectionStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
