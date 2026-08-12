"use client";

import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { AlertTriangle, DollarSign, PiggyBank, TrendingUp, Loader2 } from "lucide-react";

type CapabilityMetrics = {
  capability: string;
  name: string;
  monthlyCostUSD: number;
  wasteMetrics?: {
    orphanedResourceCount: number;
    underutilizedResourceCount: number;
    idleResourceCount: number;
    estimatedWasteUSD: number;
  };
  recommendations?: Array<{ id: string; title: string; potentialSavingsUSD: number; effort: string; roiMonths: number }>;
};

export default function AzureAIOverview() {
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const tenantId = selectedTenant?.id;

  const { data, error, isLoading } = useSWR(
    tenantId ? `/api/intelligence/azure-ai?tenantId=${tenantId}` : null,
    async (url: string) => {
      const token = await getFreshIdToken(instance, accounts[0]);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to load Azure AI overview");
      return res.json();
    }
  );
  const { data: aiAnalyticsData } = useSWR(
    tenantId ? `/api/intelligence/ai-analytics?tenantId=${tenantId}&days=30` : null,
    async (url: string) => {
      const token = await getFreshIdToken(instance, accounts[0]);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      return res.json();
    }
  );

  if (isLoading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold text-red-900 dark:text-red-200 text-sm">Error loading Azure AI overview</h3>
        </div>
      </div>
    );
  }

  const capabilitiesRaw: CapabilityMetrics[] = data?.capabilities || [];
  const foundryMtdFromAIAnalytics = Number(aiAnalyticsData?.summary?.totalCost || 0);
  const capabilities: CapabilityMetrics[] = capabilitiesRaw.map((cap) =>
    cap.capability === "foundry" && foundryMtdFromAIAnalytics > 0
      ? { ...cap, monthlyCostUSD: foundryMtdFromAIAnalytics }
      : cap
  );
  const totalCostUnified = capabilities.reduce((sum, c) => sum + Number(c.monthlyCostUSD || 0), 0);
  const baseTotal = Number(data?.totalCostUSD || 0);
  const forecastRatio = baseTotal > 0 ? Number(data?.financialSummary?.forecastEomUSD || baseTotal) / baseTotal : 1.1;
  const forecastUnified = totalCostUnified * forecastRatio;
  const topCaps = [...capabilities].sort((a, b) => (b.monthlyCostUSD || 0) - (a.monthlyCostUSD || 0));
  const topRecommendations = capabilities
    .flatMap((c) => (c.recommendations || []).map((r) => ({ ...r, capability: c.name })))
    .sort((a, b) => (b.potentialSavingsUSD || 0) - (a.potentialSavingsUSD || 0))
    .slice(0, 5);

  const riskCapabilities = capabilities.filter((c) => {
    const waste = c.wasteMetrics?.estimatedWasteUSD || 0;
    return waste > 0 || (c.wasteMetrics?.underutilizedResourceCount || 0) > 0 || (c.wasteMetrics?.orphanedResourceCount || 0) > 0;
  });

  return (
    <div className="space-y-6">
      {data?.mock && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-200">Datos demo para overview ejecutivo.</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500">Total Azure AI Cost (MTD)</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">${totalCostUnified.toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>
          <DollarSign className="w-4 h-4 text-blue-500 mt-2" />
        </div>
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500">Forecast EOM</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">${forecastUnified.toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>
          <TrendingUp className="w-4 h-4 text-blue-500 mt-2" />
        </div>
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500">Estimated Waste</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">${(data?.totalWasteUSD || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>
          <AlertTriangle className="w-4 h-4 text-amber-500 mt-2" />
        </div>
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500">Potential Savings</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">${(data?.totalPotentialSavingsUSD || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>
          <PiggyBank className="w-4 h-4 text-green-500 mt-2" />
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Cost breakdown by capability</h3>
        {topCaps.length === 0 ? (
          <p className="text-xs text-slate-500">Sin datos productivos para mostrar.</p>
        ) : (
          <div className="space-y-2">
            {topCaps.map((c) => (
              <div key={c.capability} className="flex items-center justify-between text-sm border-b border-slate-100 dark:border-slate-800 pb-2">
                <span className="text-slate-700 dark:text-slate-200">{c.name}</span>
                <div className="text-right">
                  <p className="font-semibold text-slate-900 dark:text-white">${(c.monthlyCostUSD || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>
                  <p className="text-xs text-slate-500">waste: ${(c.wasteMetrics?.estimatedWasteUSD || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Top recommendations by ROI</h3>
          {topRecommendations.length === 0 ? (
            <p className="text-xs text-slate-500">No hay recomendaciones disponibles.</p>
          ) : (
            <div className="space-y-2">
              {topRecommendations.map((r) => (
                <div key={r.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">{r.title}</p>
                  <p className="text-xs text-slate-500 mt-1">{r.capability}</p>
                  <p className="text-xs text-green-600 mt-1">
                    ${r.potentialSavingsUSD.toLocaleString("en-US", { maximumFractionDigits: 2 })} • ROI {r.roiMonths}m • {r.effort}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Risk and anomaly signals</h3>
          {riskCapabilities.length === 0 ? (
            <p className="text-xs text-slate-500">Sin señales de riesgo detectadas.</p>
          ) : (
            <div className="space-y-2">
              {riskCapabilities.map((c) => (
                <div key={c.capability} className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 rounded-lg p-3">
                  <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">{c.name}</p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                    Waste ${(c.wasteMetrics?.estimatedWasteUSD || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} •
                    Orphans {c.wasteMetrics?.orphanedResourceCount || 0} •
                    Underutilized {c.wasteMetrics?.underutilizedResourceCount || 0}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
