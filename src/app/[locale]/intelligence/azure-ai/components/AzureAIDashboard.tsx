"use client";

import React, { useEffect, useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { Loader2, Search, FileText, Mic, Eye, ShieldAlert, Cpu, Database, DollarSign, AlertTriangle } from "lucide-react";
import { getFreshIdToken } from "@/lib/msalToken";
import TierLockedNotice from "@/components/TierLockedNotice";
import AIAnalyticsDashboard from "@/components/dashboard/AIAnalyticsDashboard";

export type Capability = "search" | "document-intelligence" | "speech-language" | "vision-video" | "content-safety" | "aml" | "databricks" | "foundry";

interface CapabilityMetrics {
  capability: Capability;
  name: string;
  description: string;
  monthlyCostUSD: number;
  usage: { metric: string; value: number; unit: string }[];
  resources: Array<{ name: string; region: string; resourceGroup: string; type: string; monthlyCost: number }>;
  lastUpdated: string;
  source: "live" | "snapshot" | "mock";
}

const TABS: Array<{ id: Capability; label: string; icon: any }> = [
  { id: "foundry", label: "Azure Foundry", icon: Database },
  { id: "search", label: "AI Search", icon: Search },
  { id: "document-intelligence", label: "Document Intelligence", icon: FileText },
  { id: "speech-language", label: "Speech & Language", icon: Mic },
  { id: "vision-video", label: "Vision & Video", icon: Eye },
  { id: "content-safety", label: "Content Safety", icon: ShieldAlert },
  { id: "aml", label: "Machine Learning", icon: Cpu },
  { id: "databricks", label: "Databricks", icon: Database },
];

function CapabilityCard({ cap }: { cap?: CapabilityMetrics }) {
  if (!cap) {
    return (
      <div className="h-64 flex items-center justify-center text-center">
        <div>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No hay datos para esta capability</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Verifica que CostMeterSnapshots tenga consumo de este servicio.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-blue-50 to-slate-50 dark:from-slate-800 dark:to-slate-900 border border-blue-200 dark:border-slate-700 rounded-xl p-6">
        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1">{cap.name}</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">{cap.description}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
            <p className="text-xs text-slate-500 dark:text-slate-400">Monthly Cost</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
              ${cap.monthlyCostUSD.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
            <p className="text-xs text-slate-500 dark:text-slate-400">Data Source</p>
            <p className="text-sm font-semibold text-slate-900 dark:text-white mt-1">
              {cap.source}
              {cap.source === "mock" && <span className="ml-2 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded">Demo</span>}
            </p>
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Usage Metrics</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {cap.usage.map((u, i) => (
            <div key={i} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{u.metric}</p>
              <p className="text-lg font-bold text-slate-900 dark:text-white">{u.value.toLocaleString()}</p>
              <p className="text-xs text-slate-400 mt-1">{u.unit}</p>
            </div>
          ))}
        </div>
      </div>

      {cap.resources.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">Resources</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-800">
                  <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-400 font-medium">Name</th>
                  <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-400 font-medium">Region</th>
                  <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-400 font-medium">Resource Group</th>
                  <th className="text-right py-2 px-3 text-slate-600 dark:text-slate-400 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {cap.resources.map((r, i) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-3 text-slate-900 dark:text-slate-100 font-mono text-xs">{r.name}</td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-300 text-xs">{r.region}</td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-300 text-xs">{r.resourceGroup}</td>
                    <td className="py-3 px-3 text-slate-900 dark:text-slate-100 text-xs text-right font-semibold">
                      ${r.monthlyCost.toLocaleString("en-US", { maximumFractionDigits: 2 })}
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

interface AzureAIDashboardProps {
  initialTab?: Capability;
  showInternalTabs?: boolean;
}

export default function AzureAIDashboard({ initialTab = "search", showInternalTabs = true }: AzureAIDashboardProps) {
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const [activeTab, setActiveTab] = useState<Capability>(initialTab);
  const tenantId = selectedTenant?.id;

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const isFoundryTab = activeTab === "foundry";
  const { data, error, isLoading } = useSWR(
    tenantId && !isFoundryTab ? `/api/intelligence/azure-ai?tenantId=${tenantId}` : null,
    async (url) => {
      const token = await getFreshIdToken(instance, accounts[0]);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        if (res.status === 403) throw { status: 403 };
        throw new Error(res.statusText);
      }
      return res.json();
    }
  );

  if (error?.status === 403) {
    return <TierLockedNotice featureName="Azure AI Module" requiredTier="Professional" />;
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
        <div><h3 className="font-semibold text-red-900 dark:text-red-200 text-sm">Error loading Azure AI metrics</h3></div>
      </div>
    );
  }

  const capabilities: CapabilityMetrics[] = data?.capabilities || [];
  const currentCap = capabilities.find((c) => c.capability === activeTab);

  return (
    <div className="space-y-6">
      {data?.mock && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-200">Showing demo data. Connect your Azure subscription for live metrics.</p>
        </div>
      )}

      {showInternalTabs && (
      <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-slate-800 pb-4">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all ${
                isActive
                  ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-transparent"
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>
      )}

      {isFoundryTab ? (
        <AIAnalyticsDashboard />
      ) : isLoading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 text-blue-600 dark:text-blue-400 animate-spin" /></div>
      ) : capabilities.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-center">
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Sin datos productivos todavía</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Para tenants no-demo mostramos solo datos reales; no hay fallback a mock.</p>
          </div>
        </div>
      ) : (
        <CapabilityCard cap={currentCap} />
      )}

      {!isFoundryTab && !isLoading && capabilities.length > 0 && (
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 dark:from-blue-800 dark:to-blue-900 text-white rounded-xl p-6 shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm mb-2">Total Azure AI Monthly Cost</p>
              <p className="text-4xl font-bold">${((data?.totalCostUSD ?? data?.totalCost) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>
            </div>
            <DollarSign className="w-16 h-16 text-blue-400 opacity-30" />
          </div>
        </div>
      )}
    </div>
  );
}
