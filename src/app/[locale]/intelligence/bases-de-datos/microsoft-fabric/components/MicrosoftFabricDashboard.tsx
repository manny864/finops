"use client";

import useSWR from "swr";
import { AlertCircle, TrendingUp, Zap, Layers, Activity } from "lucide-react";
import { useState } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";

interface FabricArtefact {
  type: "dataFactory" | "synapse" | "dataWarehouse" | "powerBI" | "realtimeIntel";
  name: string;
  workspace: string;
  capacitySKU: "F64" | "F128" | "F256" | "F512" | "P1" | "P2" | "P3";
  monthlyCostUSD: number;
  capacityUtilizationPercent: number;
  peakDayUtilizationPercent: number;
  burstingRiskPercent: number; // Likelihood of throttling in next 7 days
  estimatedWasteUSD: number;
  dataStoredGB: number;
  recommendation?: string;
}

interface FabricMetrics {
  success: boolean;
  mock: boolean;
  artefacts: FabricArtefact[];
  capacitySummary: {
    totalSKUCostUSD: number;
    totalComputeCUHoursUSD: number;
    totalStorageUSD: number;
    forecastEomUSD: number;
    burstingDetected: boolean;
    throttlingRiskLevel: "low" | "medium" | "high";
  };
  onelakeMetrics: {
    totalStorageGB: number;
    duplicateDataGB: number;
    recommendedLifecycleGB: number;
    potentialSavingsUSD: number;
  };
  recommendations: Array<{
    id: string;
    title: string;
    impact: "savings" | "performance" | "reliability";
    potentialSavingsUSD: number;
    effort: "low" | "medium" | "high";
    roiMonths: number;
  }>;
  timestamp: string;
}

const fetcher = async (url: string, idToken: string) => {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok) {
    const error: any = new Error(`API error ${res.status}`);
    error.status = res.status;
    const json = await res.json().catch(() => ({}));
    error.message = json.error || `HTTP ${res.status}`;
    throw error;
  }
  return res.json();
};

export default function MicrosoftFabricDashboard() {
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const [activeTab, setActiveTab] = useState<"overview" | "artefacts" | "onelake" | "recommendations">("overview");
  const hasSession = accounts.length > 0;

  const tenantId = selectedTenant?.id;
  const swrKey = tenantId && tenantId !== "default" && hasSession
    ? `/api/intelligence/microsoft-fabric?tenantId=${tenantId}`
    : null;
  const { data, error, isLoading } = useSWR<FabricMetrics>(swrKey, async (url: string) => {
    const idToken = await getFreshIdToken(instance, accounts[0]);
    return fetcher(url, idToken);
  }, {
    revalidateOnFocus: true,
    dedupingInterval: 60000,
  });

  if (!selectedTenant) {
    return <div className="text-center py-8 text-slate-500">Select a tenant to view Fabric metrics</div>;
  }

  if (!hasSession) {
    return <div className="text-center py-8">Loading Fabric metrics...</div>;
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg flex gap-3 border border-red-200 dark:border-red-800">
        <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-red-700 dark:text-red-300 font-medium">Failed to load Microsoft Fabric metrics</p>
          <p className="text-red-600 dark:text-red-400 text-sm mt-1">{error.message || "Unknown error"}</p>
          {error.status === 401 && (
            <p className="text-red-600 dark:text-red-400 text-xs mt-2">
              Authorization failed. Please check your Azure permissions.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return <div className="text-center py-8">Loading Fabric metrics...</div>;
  }

  // Validate data structure
  if (!data.capacitySummary) {
    return (
      <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg flex gap-3 border border-amber-200 dark:border-amber-800">
        <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-amber-700 dark:text-amber-300 font-medium">Invalid response format</p>
          <p className="text-amber-600 dark:text-amber-400 text-sm mt-1">Capacity summary data is missing</p>
        </div>
      </div>
    );
  }

  // Provide defaults for optional fields
  const safeData: FabricMetrics = {
    ...data,
    artefacts: data.artefacts || [],
    onelakeMetrics: data.onelakeMetrics || {
      totalStorageGB: 0,
      duplicateDataGB: 0,
      recommendedLifecycleGB: 0,
      potentialSavingsUSD: 0,
    },
    recommendations: data.recommendations || [],
  };

  const tabs = [
    { id: "overview" as const, label: "Capacity & Cost", icon: <Zap className="w-4 h-4" /> },
    { id: "artefacts" as const, label: "Artefacts", icon: <Layers className="w-4 h-4" /> },
    { id: "onelake" as const, label: "OneLake Storage", icon: <Activity className="w-4 h-4" /> },
    { id: "recommendations" as const, label: "Recommendations", icon: <TrendingUp className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-6">
      {data.mock && (
        <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg flex gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-300">Demo data. Real metrics require active Fabric capacity.</p>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-[#6B35C1] text-[#6B35C1]"
                : "border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Monthly Cost</div>
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                ${data.capacitySummary.totalSKUCostUSD.toLocaleString()}
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 mt-2">
                SKU: ${data.capacitySummary.totalSKUCostUSD.toLocaleString()} | Compute: ${data.capacitySummary.totalComputeCUHoursUSD.toLocaleString()}
              </div>
            </div>

            <div className={`p-4 rounded-lg border ${
              data.capacitySummary.throttlingRiskLevel === "high"
                ? "bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700"
                : data.capacitySummary.throttlingRiskLevel === "medium"
                ? "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700"
                : "bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700"
            }`}>
              <div className="text-xs font-medium">
                {data.capacitySummary.throttlingRiskLevel === "high" && "⚠️ High Throttling Risk"}
                {data.capacitySummary.throttlingRiskLevel === "medium" && "⚡ Medium Throttling Risk"}
                {data.capacitySummary.throttlingRiskLevel === "low" && "✓ Low Throttling Risk"}
              </div>
              <div className="text-sm mt-2">
                {data.capacitySummary.burstingDetected && (
                  <p className="font-semibold">Bursting detected in last 7 days</p>
                )}
                <p className="text-xs mt-1">Forecast EOM: ${data.capacitySummary.forecastEomUSD.toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
            <h3 className="font-medium text-slate-900 dark:text-slate-100 mb-3">Capacity Utilization (Interactive Operations)</h3>
            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span>Average Utilization</span>
                  <span className="font-semibold">{safeData.artefacts[0]?.capacityUtilizationPercent || 0}%</span>
                </div>
                <div className="w-full bg-slate-300 dark:bg-slate-600 rounded-full h-2">
                  <div
                    className="bg-[#6B35C1] h-2 rounded-full"
                    style={{ width: `${safeData.artefacts[0]?.capacityUtilizationPercent || 0}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span>Peak Day Utilization</span>
                  <span className="font-semibold">{safeData.artefacts[0]?.peakDayUtilizationPercent || 0}%</span>
                </div>
                <div className="w-full bg-slate-300 dark:bg-slate-600 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${safeData.artefacts[0]?.peakDayUtilizationPercent || 0 > 85 ? "bg-red-500" : "bg-orange-500"}`}
                    style={{ width: `${safeData.artefacts[0]?.peakDayUtilizationPercent || 0}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Artefacts Tab */}
      {activeTab === "artefacts" && (
        <div className="space-y-3">
          {safeData.artefacts.map((artefact: FabricArtefact, idx: number) => (
            <div key={idx} className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h4 className="font-semibold text-slate-900 dark:text-slate-100">{artefact.name}</h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    {artefact.type.replace(/([A-Z])/g, " $1")} • {artefact.workspace} • {artefact.capacitySKU}
                  </p>
                </div>
                <span className="text-sm font-bold text-[#6B35C1]">${artefact.monthlyCostUSD.toLocaleString()}</span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
                <div>
                  <div className="text-slate-600 dark:text-slate-400">Utilization</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{artefact.capacityUtilizationPercent}%</div>
                </div>
                <div>
                  <div className="text-slate-600 dark:text-slate-400">Bursting Risk</div>
                  <div className={`font-semibold ${artefact.burstingRiskPercent > 50 ? "text-red-600" : "text-green-600"}`}>
                    {artefact.burstingRiskPercent}%
                  </div>
                </div>
                <div>
                  <div className="text-slate-600 dark:text-slate-400">Storage</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{artefact.dataStoredGB}GB</div>
                </div>
                <div>
                  <div className="text-slate-600 dark:text-slate-400">Est. Waste</div>
                  <div className="font-semibold text-red-600">${artefact.estimatedWasteUSD}</div>
                </div>
              </div>

              {artefact.recommendation && (
                <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded text-xs text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700">
                  💡 {artefact.recommendation}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* OneLake Tab */}
      {activeTab === "onelake" && (
        <div className="space-y-4">
          <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
            <h3 className="font-medium text-slate-900 dark:text-slate-100 mb-4">OneLake Storage Breakdown</h3>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>Total Storage</span>
                  <span className="font-semibold">{safeData.onelakeMetrics.totalStorageGB.toLocaleString()} GB</span>
                </div>
                <div className="w-full bg-slate-300 dark:bg-slate-600 rounded-full h-3">
                  <div className="bg-[#6B35C1] h-3 rounded-full" style={{ width: "100%" }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>Estimated Duplicate Data</span>
                  <span className="font-semibold text-orange-600">{safeData.onelakeMetrics.duplicateDataGB.toLocaleString()} GB</span>
                </div>
                <div className="w-full bg-slate-300 dark:bg-slate-600 rounded-full h-3">
                  <div
                    className="bg-orange-500 h-3 rounded-full"
                    style={{ width: `${(safeData.onelakeMetrics.duplicateDataGB / safeData.onelakeMetrics.totalStorageGB) * 100}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>Recommended for Lifecycle Management</span>
                  <span className="font-semibold text-yellow-600">{safeData.onelakeMetrics.recommendedLifecycleGB.toLocaleString()} GB</span>
                </div>
                <div className="w-full bg-slate-300 dark:bg-slate-600 rounded-full h-3">
                  <div
                    className="bg-yellow-500 h-3 rounded-full"
                    style={{ width: `${(safeData.onelakeMetrics.recommendedLifecycleGB / safeData.onelakeMetrics.totalStorageGB) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 bg-green-50 dark:bg-green-900/20 p-3 rounded border border-green-200 dark:border-green-700">
              <p className="text-sm font-semibold text-green-900 dark:text-green-100">
                Potential Monthly Savings: ${safeData.onelakeMetrics.potentialSavingsUSD.toLocaleString()}
              </p>
              <p className="text-xs text-green-800 dark:text-green-200 mt-1">
                Via deduplication and lifecycle policies (cold storage)
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Recommendations Tab */}
      {activeTab === "recommendations" && (
        <div className="space-y-3">
          {safeData.recommendations.map((rec: any, idx: number) => (
            <div key={idx} className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="flex justify-between items-start mb-2">
                <h4 className="font-semibold text-slate-900 dark:text-slate-100">{rec.title}</h4>
                <span className={`text-xs font-bold px-2 py-1 rounded ${
                  rec.impact === "savings" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" :
                  rec.impact === "performance" ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" :
                  "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
                }`}>
                  {rec.impact}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs mb-3">
                <div>
                  <div className="text-slate-600 dark:text-slate-400">Potential Savings</div>
                  <div className="font-semibold text-green-600">${rec.potentialSavingsUSD.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-slate-600 dark:text-slate-400">Effort</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {rec.effort.charAt(0).toUpperCase() + rec.effort.slice(1)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-600 dark:text-slate-400">ROI Timeline</div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100">{rec.roiMonths} month{rec.roiMonths !== 1 ? "s" : ""}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-slate-500 dark:text-slate-400 text-right">
        Last updated: {new Date(data.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}
