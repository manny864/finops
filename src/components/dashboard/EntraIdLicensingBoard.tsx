"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Users, DollarSign, Layers, TrendingUp, AlertCircle } from "lucide-react";

interface EntraIdLicense {
  licenseType: "Free" | "Premium P1" | "Premium P2" | "Standalone";
  assignedLicenses: number;
  remainingLicenses: number;
  totalLicenses: number;
  costPerLicensePerMonth: number;
  estimatedMonthlyCost: number;
  usagePercentage: number;
  recommendations: string[];
  lastSyncedAt: string;
}

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const getLicenseColor = (licenseType: string) => {
  if (licenseType === "Premium P2")
    return "from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20";
  if (licenseType === "Premium P1")
    return "from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20";
  return "from-gray-50 to-slate-50 dark:from-slate-800/50 dark:to-slate-900/50";
};

const getLicenseIcon = (licenseType: string) => {
  if (licenseType === "Premium P2") return "👑";
  if (licenseType === "Premium P1") return "⭐";
  return "🆓";
};

export default function EntraIdLicensingBoard() {
  const t = useTranslations("Defender");
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const idToken = await getFreshIdToken(instance, accounts[0]);
      const res = await fetch(`/api/intelligence/entra-id?tenantId=${encodeURIComponent(selectedTenant.id)}`, {
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

  const licenses: EntraIdLicense[] = data.licenseBreakdown || [];

  return (
    <div className="p-6 w-full animate-in fade-in duration-500 space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1 flex items-center gap-1">
            <Users className="w-4 h-4" />
            Usuarios Activos
          </h3>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{data.totalActiveUsers || 0}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1 flex items-center gap-1">
            <Layers className="w-4 h-4" />
            Licencias Asignadas
          </h3>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{data.totalAssignedLicenses || 0}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1 flex items-center gap-1">
            <TrendingUp className="w-4 h-4" />
            Cobertura
          </h3>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{data.licenseCoverage || 0}%</p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1 flex items-center gap-1">
            <DollarSign className="w-4 h-4" />
            Costo Mensual
          </h3>
          <p className="text-2xl font-bold text-brand-deep">{fmt.format(data.totalSubscriptionsAmount || 0)}</p>
        </div>
      </div>

      {/* License Cards */}
      <div className="space-y-4">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">Desglose de Licencias</h2>

        <div className="grid gap-4 grid-cols-1 lg:grid-cols-3">
          {licenses.map((license) => (
            <div
              key={license.licenseType}
              className={`bg-gradient-to-br ${getLicenseColor(
                license.licenseType
              )} rounded-lg border border-gray-200 dark:border-slate-800 p-5 shadow-sm hover:shadow-md transition-shadow`}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <span>{getLicenseIcon(license.licenseType)}</span>
                    {license.licenseType}
                  </h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    {fmt.format(license.costPerLicensePerMonth)}/usuario/mes
                  </p>
                </div>
              </div>

              {/* Stats */}
              <div className="space-y-2 mb-4 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 dark:text-gray-300 font-semibold">Asignadas:</span>
                  <span className="font-bold text-gray-900 dark:text-white">{license.assignedLicenses}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 dark:text-gray-300 font-semibold">Disponibles:</span>
                  <span className="font-bold text-green-600 dark:text-green-400">{license.remainingLicenses}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-700 dark:text-gray-300 font-semibold">Total:</span>
                  <span className="font-mono text-gray-600 dark:text-gray-400">{license.totalLicenses}</span>
                </div>
              </div>

              {/* Usage Bar */}
              <div className="mb-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-gray-600 dark:text-gray-400">Utilización</span>
                  <span className="text-xs font-bold text-gray-900 dark:text-white">{license.usagePercentage.toFixed(1)}%</span>
                </div>
                <div className="w-full h-2 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${
                      license.usagePercentage > 90
                        ? "bg-red-500"
                        : license.usagePercentage > 75
                          ? "bg-amber-500"
                          : "bg-green-500"
                    }`}
                    style={{ width: `${Math.min(license.usagePercentage, 100)}%` }}
                  ></div>
                </div>
              </div>

              {/* Monthly Cost */}
              <div className="pt-3 border-t border-gray-300 dark:border-slate-700">
                <p className="text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Costo mensual:</span>
                  <span className="font-bold text-brand-deep ml-2">{fmt.format(license.estimatedMonthlyCost)}</span>
                </p>
              </div>

              {/* Warnings */}
              {license.usagePercentage > 90 && (
                <div className="mt-3 p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {license.licenseType === "Free" ? "Solo 50 licencias disponibles" : "Baja disponibilidad de licencias"}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Recommendations Table */}
      {licenses.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Recomendaciones de Optimización</h2>
          <div className="space-y-3">
            {licenses.map((license) => (
              <div
                key={license.licenseType}
                className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4"
              >
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                  <span>{getLicenseIcon(license.licenseType)}</span>
                  {license.licenseType}
                </h3>
                <ul className="space-y-1">
                  {license.recommendations.map((rec, idx) => (
                    <li key={idx} className="text-sm text-gray-700 dark:text-gray-300 flex gap-2">
                      <span className="text-blue-500 flex-shrink-0">•</span>
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Table */}
      {licenses.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Resumen de Costos</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800">
              <thead>
                <tr className="border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">
                    Tipo de Licencia
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300">
                    Usuarios
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300">
                    Disponibles
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300">
                    Utilización
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300">
                    Costo Mensual
                  </th>
                </tr>
              </thead>
              <tbody>
                {licenses.map((license) => (
                  <tr
                    key={license.licenseType}
                    className="border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50"
                  >
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white">
                      {getLicenseIcon(license.licenseType)} {license.licenseType}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white font-semibold">
                      {license.assignedLicenses}/{license.totalLicenses}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                      {license.remainingLicenses}
                    </td>
                    <td className="px-4 py-3 text-sm text-right">
                      <span
                        className={`px-2 py-1 rounded text-xs font-semibold ${
                          license.usagePercentage > 90
                            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            : license.usagePercentage > 75
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                              : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                        }`}
                      >
                        {license.usagePercentage.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-brand-deep font-bold">
                      {fmt.format(license.estimatedMonthlyCost)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800">
                  <td colSpan={4} className="px-4 py-3 text-sm font-bold text-gray-900 dark:text-white">
                    TOTAL MENSUAL
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-bold text-brand-deep">
                    {fmt.format(data.totalSubscriptionsAmount || 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
