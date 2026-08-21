"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Globe, Zap, AlertCircle } from "lucide-react";

interface WafMetrics {
  costPerMonth: number;
  costPerApplication: number;
  costPerMillionRequests: number;
  costPerGbProcessed: number;
  capacityUnitsConsumed: number;
  throughputGb: number;
  falsePositiveRate: number;
}

interface WafApplication {
  name: string;
  type: "Application Gateway" | "Front Door";
  region: string;
  resourceGroup: string;
  status: "Enabled" | "Disabled";
  mode: "Detection" | "Prevention";
  owaspVersion: string;
  totalRequests: number;
  blockedRequests: number;
  allowedRequests: number;
  blockRate: number;
}

interface WafSecurityInsight {
  ruleType: string;
  count: number;
  severity: "Low" | "Medium" | "High" | "Critical";
  examples: string[];
}

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numfmt = new Intl.NumberFormat("en-US");

const getSeverityColor = (severity: string) => {
  if (severity === "Critical") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  if (severity === "High") return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400";
  if (severity === "Medium") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
  return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
};

export default function WafDashboard() {
  const t = useTranslations("Defender");
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedApp, setExpandedApp] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const idToken = await getFreshIdToken(instance, accounts[0]);
      const res = await fetch(`/api/intelligence/waf?tenantId=${encodeURIComponent(selectedTenant.id)}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) throw new Error(t("toast_load_error"));
      const json = await res.json();
      setData(json);
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

  if (!data) return null;

  const metrics: WafMetrics = data.metrics;
  const applications: WafApplication[] = data.applications || [];
  const rulesFired: WafSecurityInsight[] = data.rulesFired || [];
  const topBlockedIps = data.topBlockedIps || [];
  const topCountries = data.topCountries || [];

  return (
    <div className="p-6 w-full animate-in fade-in duration-500 space-y-6">
      {/* KPIs Row 1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Costo Mensual</h3>
          <p className="text-2xl font-bold text-brand-deep">{fmt.format(data.totalMonthlyCost)}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {numfmt.format(data.applicationsProtected)} aplicaciones
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Solicitudes Totales</h3>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{numfmt.format(data.totalRequests)}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">45.2M al mes</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1 flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" />
            Bloqueadas
          </h3>
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">
            {numfmt.format(data.totalBlockedRequests)}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Tasa: {data.overallBlockRate.toFixed(2)}%</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Falsos Positivos</h3>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{metrics.falsePositiveRate.toFixed(2)}%</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Muy bajo (ideal &lt;0.5%)</p>
        </div>
      </div>

      {/* Cost Metrics */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Métricas de Costo</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-3 bg-gray-50 dark:bg-slate-800 rounded-lg">
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Costo por Aplicación</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{fmt.format(metrics.costPerApplication)}</p>
          </div>
          <div className="p-3 bg-gray-50 dark:bg-slate-800 rounded-lg">
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Costo por 1M Requests</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{fmt.format(metrics.costPerMillionRequests)}</p>
          </div>
          <div className="p-3 bg-gray-50 dark:bg-slate-800 rounded-lg">
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Costo por GB</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{fmt.format(metrics.costPerGbProcessed)}</p>
          </div>
          <div className="p-3 bg-gray-50 dark:bg-slate-800 rounded-lg">
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Throughput</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{numfmt.format(metrics.throughputGb)} GB</p>
          </div>
        </div>
      </div>

      {/* Applications Protected */}
      {applications.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Aplicaciones Protegidas</h2>
          <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
            {applications.map((app) => (
              <div
                key={app.name}
                className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 overflow-hidden hover:shadow-md transition-shadow"
              >
                <div
                  className="p-4 cursor-pointer bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-800 dark:to-slate-900 border-b border-gray-200 dark:border-slate-700 flex justify-between items-start"
                  onClick={() => setExpandedApp(expandedApp === app.name ? null : app.name)}
                >
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{app.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-1 rounded">
                        {app.type}
                      </span>
                      <span className={`text-xs px-2 py-1 rounded font-semibold ${app.mode === "Prevention" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"}`}>
                        {app.mode}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-red-600 dark:text-red-400">{numfmt.format(app.blockedRequests)}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">bloqueadas</p>
                  </div>
                </div>

                {expandedApp === app.name && (
                  <div className="p-4 space-y-3 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-200 dark:border-slate-700">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-gray-600 dark:text-gray-400">Región:</span>
                        <p className="font-semibold text-gray-900 dark:text-white">{app.region}</p>
                      </div>
                      <div>
                        <span className="text-gray-600 dark:text-gray-400">OWASP:</span>
                        <p className="font-semibold text-gray-900 dark:text-white">{app.owaspVersion}</p>
                      </div>
                      <div>
                        <span className="text-gray-600 dark:text-gray-400">Total Requests:</span>
                        <p className="font-semibold text-gray-900 dark:text-white">
                          {numfmt.format(app.totalRequests)}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-600 dark:text-gray-400">Block Rate:</span>
                        <p className="font-semibold text-gray-900 dark:text-white">{app.blockRate.toFixed(2)}%</p>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-gray-200 dark:border-slate-700">
                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Solicitudes Permitidas vs Bloqueadas</p>
                      <div className="flex gap-2 h-6 rounded-lg overflow-hidden bg-gray-200 dark:bg-slate-700">
                        <div
                          className="bg-green-500 flex items-center justify-center text-white text-xs font-bold"
                          style={{
                            width: `${(app.allowedRequests / (app.allowedRequests + app.blockedRequests)) * 100}%`,
                          }}
                        >
                          {((app.allowedRequests / (app.allowedRequests + app.blockedRequests)) * 100).toFixed(1)}%
                        </div>
                        <div
                          className="bg-red-500 flex items-center justify-center text-white text-xs font-bold"
                          style={{
                            width: `${(app.blockedRequests / (app.allowedRequests + app.blockedRequests)) * 100}%`,
                          }}
                        >
                          {((app.blockedRequests / (app.allowedRequests + app.blockedRequests)) * 100).toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Security Threats */}
      {rulesFired.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Principales Amenazas Detectadas</h2>
          <div className="space-y-3">
            {rulesFired.map((rule) => (
              <div key={rule.ruleType} className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    {rule.ruleType}
                  </h3>
                  <span className={`text-xs px-2 py-1 rounded font-semibold ${getSeverityColor(rule.severity)}`}>
                    {rule.severity}
                  </span>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                  <span className="font-bold text-gray-900 dark:text-white">{numfmt.format(rule.count)}</span> intentos detectados
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">Ejemplos bloqueados:</p>
                <ul className="space-y-1">
                  {rule.examples.map((ex, idx) => (
                    <li key={idx} className="text-xs bg-gray-50 dark:bg-slate-800 p-2 rounded font-mono text-gray-700 dark:text-gray-300 break-all">
                      {ex}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Blocked IPs & Countries */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
        {/* Top Blocked IPs */}
        {topBlockedIps.length > 0 && (
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
            <h3 className="font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Top IPs Bloqueadas
            </h3>
            <div className="space-y-2">
              {topBlockedIps.slice(0, 5).map((item: any, idx: number) => (
                <div key={idx} className="flex justify-between items-center p-2 bg-gray-50 dark:bg-slate-800 rounded">
                  <div className="flex-1">
                    <p className="text-xs font-mono text-gray-900 dark:text-white">{item.ip}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{item.country}</p>
                  </div>
                  <span className="text-xs font-bold text-red-600 dark:text-red-400">{numfmt.format(item.requestsBlocked)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top Countries */}
        {topCountries.length > 0 && (
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
            <h3 className="font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Top Países Bloqueados
            </h3>
            <div className="space-y-2">
              {topCountries.slice(0, 5).map((item: any, idx: number) => (
                <div key={idx} className="flex justify-between items-center p-2 bg-gray-50 dark:bg-slate-800 rounded">
                  <p className="text-xs font-semibold text-gray-900 dark:text-white">{item.country}</p>
                  <div className="flex-1 mx-2 h-2 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-orange-400 to-red-500 h-full"
                      style={{ width: `${Math.min((item.requestsBlocked / 300000) * 100, 100)}%` }}
                    ></div>
                  </div>
                  <span className="text-xs font-bold text-red-600 dark:text-red-400 min-w-[60px] text-right">
                    {numfmt.format(item.requestsBlocked)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
