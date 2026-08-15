"use client";

import React, { useEffect, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import {
  IconSearch,
  IconFileText,
  IconMicrophone,
  IconEye,
  IconShieldCheck,
  IconCpu,
  IconDatabase,
  IconCurrencyDollar,
  IconAlertCircle,
  IconRefresh,
  IconExternalLink,
  IconSettings,
  IconSparkles,
  IconActivity,
  IconLayersLinked,
  IconLoader2,
  IconCheck,
} from "@tabler/icons-react";
import { getFreshIdToken } from "@/lib/msalToken";
import TierLockedNotice from "@/components/TierLockedNotice";
import AIAnalyticsDashboard from "@/components/dashboard/AIAnalyticsDashboard";

export type Capability =
  | "search"
  | "document-intelligence"
  | "speech-language"
  | "vision-video"
  | "content-safety"
  | "aml"
  | "databricks"
  | "foundry";

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

const TABS: Array<{ id: Capability; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "foundry", label: "Azure AI Foundry", icon: IconDatabase },
  { id: "search", label: "Azure AI Search", icon: IconSearch },
  { id: "document-intelligence", label: "Document Intelligence", icon: IconFileText },
  { id: "speech-language", label: "Speech & Language", icon: IconMicrophone },
  { id: "vision-video", label: "Vision & Video", icon: IconEye },
  { id: "content-safety", label: "Content Safety", icon: IconShieldCheck },
  { id: "aml", label: "Machine Learning", icon: IconCpu },
  { id: "databricks", label: "Azure Databricks", icon: IconLayersLinked },
];

const CAPABILITY_INFO: Record<Capability, { title: string; subtitle: string; portalUrl: string }> = {
  foundry: {
    title: "Azure AI Foundry",
    subtitle: "Catálogo unificado de modelos GenAI, orquestación de prompts y endpoints de inferencia.",
    portalUrl: "https://ai.azure.com",
  },
  search: {
    title: "Azure AI Search",
    subtitle: "Búsqueda vectorial, ranking semántico e indexación para arquitecturas RAG híbridas.",
    portalUrl: "https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.Search%2FsearchServices",
  },
  "document-intelligence": {
    title: "Azure AI Document Intelligence",
    subtitle: "Modelos de deep learning para extracción automatizada de texto, tablas y formularios estructurados.",
    portalUrl: "https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.CognitiveServices%2Faccounts",
  },
  "speech-language": {
    title: "Azure AI Speech & Language",
    subtitle: "Transcripción de voz a texto, traducción en tiempo real y procesamiento de lenguaje natural.",
    portalUrl: "https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.CognitiveServices%2Faccounts",
  },
  "vision-video": {
    title: "Azure AI Vision & Video Indexer",
    subtitle: "Análisis y reconocimiento visual, OCR avanzado, detección de objetos y etiquetado automático.",
    portalUrl: "https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.CognitiveServices%2Faccounts",
  },
  "content-safety": {
    title: "Azure AI Content Safety",
    subtitle: "Moderación de contenido con IA para detección y filtrado de texto e imágenes.",
    portalUrl: "https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.CognitiveServices%2Faccounts",
  },
  aml: {
    title: "Azure Machine Learning",
    subtitle: "Plataforma MLOps para entrenamiento, registro, despliegue y monitoreo de modelos propios.",
    portalUrl: "https://ml.azure.com",
  },
  databricks: {
    title: "Azure Databricks",
    subtitle: "Analítica distribuida en Apache Spark, MLflow para seguimiento de experimentos y fine-tuning.",
    portalUrl: "https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.Databricks%2Fworkspaces",
  },
};

function EmptyCapabilityView({
  capability,
  onRefresh,
  isRefreshing,
}: {
  capability: Capability;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const t = useTranslations("AzureAI");
  const info = CAPABILITY_INFO[capability] || {
    title: "Azure AI Service",
    subtitle: "Monitoreo de telemetría y costos de servicios de inteligencia artificial.",
    portalUrl: "https://portal.azure.com",
  };

  return (
    <div className="space-y-6">
      {/* Header del Servicio */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-[#1B2A41] dark:text-slate-100 font-heading">
              {info.title}
            </h3>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-900/50 px-2 py-0.5 rounded-full">
              <IconCheck className="w-3 h-3" />
              {t("status_ready")}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
            {info.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            <IconRefresh className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-[#0054A6]" : ""}`} />
            {t("btn_sync")}
          </button>
          <a
            href={info.portalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0054A6] hover:bg-[#004080] rounded-lg transition-colors shadow-xs"
          >
            <IconExternalLink className="w-3.5 h-3.5" />
            {t("btn_azure_portal")}
          </a>
        </div>
      </div>

      {/* Hero Empty State */}
      <div className="bg-gradient-to-b from-slate-50/80 to-white dark:from-slate-900/80 dark:to-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-8 text-center relative overflow-hidden shadow-xs">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center text-[#0054A6] dark:text-[#00AEEF] mb-4 shadow-inner">
          <IconSparkles className="w-7 h-7" />
        </div>

        <h4 className="text-base font-bold text-[#1B2A41] dark:text-slate-100 font-heading mb-1.5">
          {t("empty_title")}
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-lg mx-auto leading-relaxed">
          {t("empty_description")}
        </p>

        {/* 3 Pasos de Activación */}
        <div className="mt-8 pt-6 border-t border-slate-200/70 dark:border-slate-800 text-left">
          <h5 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-4 text-center">
            {t("quick_guide_title")}
          </h5>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 rounded-xl p-4 transition-all hover:border-[#0054A6]/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-md bg-blue-50 dark:bg-blue-950/50 text-[#0054A6] dark:text-blue-400 flex items-center justify-center text-xs font-bold">
                  1
                </span>
                <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-200">
                  {t("step1_title")}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                {t("step1_desc")}
              </p>
            </div>

            <div className="bg-white dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 rounded-xl p-4 transition-all hover:border-[#0054A6]/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-md bg-blue-50 dark:bg-blue-950/50 text-[#0054A6] dark:text-blue-400 flex items-center justify-center text-xs font-bold">
                  2
                </span>
                <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-200">
                  {t("step2_title")}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                {t("step2_desc")}
              </p>
            </div>

            <div className="bg-white dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 rounded-xl p-4 transition-all hover:border-[#0054A6]/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-md bg-blue-50 dark:bg-blue-950/50 text-[#0054A6] dark:text-blue-400 flex items-center justify-center text-xs font-bold">
                  3
                </span>
                <span className="text-xs font-bold text-[#1B2A41] dark:text-slate-200">
                  {t("step3_title")}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                {t("step3_desc")}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Grid de Previsualización de Métricas */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            {t("preview_title")}
          </h4>
          <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
            {t("preview_badge")}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 opacity-75">
          <div className="bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-4">
            <p className="text-[11px] text-slate-400 font-medium mb-1">{t("preview_cost")}</p>
            <p className="text-xl font-bold text-slate-700 dark:text-slate-300 font-mono">$0.00</p>
            <p className="text-[10px] text-slate-400 mt-1">USD acumulado</p>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-4">
            <p className="text-[11px] text-slate-400 font-medium mb-1">{t("preview_ops")}</p>
            <p className="text-xl font-bold text-slate-700 dark:text-slate-300 font-mono">0</p>
            <p className="text-[10px] text-slate-400 mt-1">Llamadas REST / API</p>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-4">
            <p className="text-[11px] text-slate-400 font-medium mb-1">{t("preview_tokens")}</p>
            <p className="text-xl font-bold text-slate-700 dark:text-slate-300 font-mono">0</p>
            <p className="text-[10px] text-slate-400 mt-1">Prompt & Completion</p>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-4">
            <p className="text-[11px] text-slate-400 font-medium mb-1">{t("preview_resources")}</p>
            <p className="text-xl font-bold text-slate-700 dark:text-slate-300 font-mono">0</p>
            <p className="text-[10px] text-slate-400 mt-1">Instancias activas</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function CapabilityCard({ cap, onRefresh, isRefreshing }: { cap?: CapabilityMetrics; onRefresh: () => void; isRefreshing: boolean }) {
  const t = useTranslations("AzureAI");
  if (!cap || (!cap.monthlyCostUSD && (!cap.resources || cap.resources.length === 0))) {
    return <EmptyCapabilityView capability={(cap?.capability as Capability) || "search"} onRefresh={onRefresh} isRefreshing={isRefreshing} />;
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-blue-50 to-slate-50 dark:from-slate-800 dark:to-slate-900 border border-blue-200 dark:border-slate-700 rounded-xl p-6">
        <h3 className="text-xl font-bold text-[#1B2A41] dark:text-white font-heading mb-1">{cap.name}</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">{cap.description}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
          <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
            <p className="text-xs text-slate-500 dark:text-slate-400">{t("monthly_cost")}</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1 font-mono">
              ${cap.monthlyCostUSD.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700">
            <p className="text-xs text-slate-500 dark:text-slate-400">{t("data_source")}</p>
            <p className="text-sm font-semibold text-slate-900 dark:text-white mt-1">
              {cap.source === "live" ? t("live_source") : cap.source}
              {cap.source === "mock" && <span className="ml-2 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded font-bold">Demo</span>}
            </p>
          </div>
        </div>
      </div>

      {cap.usage && cap.usage.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-[#1B2A41] dark:text-white font-heading mb-3">{t("usage_metrics")}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {cap.usage.map((u, i) => (
              <div key={i} className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg p-4">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{u.metric}</p>
                <p className="text-lg font-bold text-slate-900 dark:text-white font-mono">{u.value.toLocaleString()}</p>
                <p className="text-xs text-slate-400 mt-1">{u.unit}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {cap.resources && cap.resources.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-[#1B2A41] dark:text-white font-heading mb-3">{t("resources")}</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-800">
                  <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-400 font-medium">{t("resource_name")}</th>
                  <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-400 font-medium">{t("resource_region")}</th>
                  <th className="text-left py-2 px-3 text-slate-600 dark:text-slate-400 font-medium">{t("resource_group")}</th>
                  <th className="text-right py-2 px-3 text-slate-600 dark:text-slate-400 font-medium">{t("resource_cost")}</th>
                </tr>
              </thead>
              <tbody>
                {cap.resources.map((r, i) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-3 text-slate-900 dark:text-slate-100 font-mono text-xs">{r.name}</td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-300 text-xs">{r.region}</td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-300 text-xs">{r.resourceGroup}</td>
                    <td className="py-3 px-3 text-slate-900 dark:text-slate-100 text-xs text-right font-semibold font-mono">
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

export default function AzureAIDashboard({ initialTab = "foundry", showInternalTabs = true }: AzureAIDashboardProps) {
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const [activeTab, setActiveTab] = useState<Capability>(initialTab);
  const t = useTranslations("AzureAI");
  const tenantId = selectedTenant?.id;

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const isFoundryTab = activeTab === "foundry";
  const { data, error, isLoading, mutate, isValidating } = useSWR(
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

  const handleRefresh = () => {
    mutate();
  };

  if (error?.status === 403) {
    return <TierLockedNotice featureName="Azure AI Module" requiredTier="Professional" />;
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3">
        <IconAlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold text-red-900 dark:text-red-200 text-sm">Error cargando métricas de Azure AI</h3>
          <p className="text-xs text-red-700 dark:text-red-300 mt-1">{error.message || "No se pudieron obtener los datos."}</p>
        </div>
      </div>
    );
  }

  const capabilities: CapabilityMetrics[] = data?.capabilities || [];
  const currentCap = capabilities.find((c) => c.capability === activeTab);

  return (
    <div className="space-y-6">
      {data?.mock && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-3 flex items-start gap-2">
          <IconAlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Visualizando datos de demostración. Conecta tu suscripción de Azure para ver telemetría en vivo.
          </p>
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
                className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  isActive
                    ? "bg-blue-50 dark:bg-blue-900/30 text-[#0054A6] dark:text-[#00AEEF] border border-blue-200 dark:border-blue-700 shadow-xs"
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
        <div className="flex flex-col items-center justify-center h-64 gap-3">
          <IconLoader2 className="w-8 h-8 text-[#0054A6] dark:text-[#00AEEF] animate-spin" />
          <p className="text-xs text-slate-500 dark:text-slate-400">Consultando telemetría de Azure AI...</p>
        </div>
      ) : (
        <CapabilityCard cap={currentCap || { capability: activeTab, name: CAPABILITY_INFO[activeTab]?.title || activeTab, description: CAPABILITY_INFO[activeTab]?.subtitle || '', monthlyCostUSD: 0, usage: [], resources: [], lastUpdated: new Date().toISOString(), source: 'live' }} onRefresh={handleRefresh} isRefreshing={isValidating} />
      )}

      {!isFoundryTab && !isLoading && capabilities.length > 0 && ((data?.totalCostUSD ?? data?.totalCost) || 0) > 0 && (
        <div className="bg-gradient-to-br from-[#0054A6] to-[#003B75] text-white rounded-xl p-6 shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-xs uppercase tracking-wider font-semibold mb-1">
                {t("total_monthly_cost")}
              </p>
              <p className="text-3xl font-extrabold font-mono">
                ${((data?.totalCostUSD ?? data?.totalCost) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
              </p>
            </div>
            <IconCurrencyDollar className="w-14 h-14 text-blue-300 opacity-20" />
          </div>
        </div>
      )}
    </div>
  );
}
