"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { getFreshIdToken } from "@/lib/msalToken";
import { isMockTenant } from "@/lib/mockData";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Shield, AlertTriangle, TrendingDown, Activity, Clock, MapPin, ChevronDown } from "lucide-react";

interface DdosPlan {
  planId: string;
  planName: string;
  region: string;
  resourceGroup: string;
  costPerMonth: number;
  protectedVnets: number;
  protectedPublicIps: number;
  protectedApplications: number;
  status: "Active" | "Inactive";
  createdDate: string;
}

interface DdosAttack {
  id: string;
  type: "Volumetric" | "TCP SYN Flood" | "UDP Flood" | "Reflection Amplification" | "Other";
  startTime: string;
  duration: number;
  peakTrafficGbps: number;
  packetsPerSecond: number;
  sourceCountries: string[];
  targetResourceId: string;
  mitigationStatus: "Mitigated" | "In Progress" | "Failed";
  bytesDropped: number;
}

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numfmt = new Intl.NumberFormat("en-US");

const getRiskColor = (risk: string) => {
  if (risk === "Critical") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  if (risk === "High") return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400";
  if (risk === "Medium") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
  return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
};

const getAttackTypeColor = (type: string) => {
  if (type === "Reflection Amplification") return "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800";
  if (type === "TCP SYN Flood") return "bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800";
  if (type === "UDP Flood") return "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800";
  return "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700";
};

export default function DdosProtectionDashboard() {
  const t = useTranslations("Defender");
  const { selectedTenant } = useTenant();
  const { instance, accounts } = useMsal();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedAttack, setExpandedAttack] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const idToken = await getFreshIdToken(instance, accounts[0]);
      const res = await fetch(
        `/api/intelligence/ddos-protection?tenantId=${encodeURIComponent(selectedTenant.id)}`,
        {
          headers: { Authorization: `Bearer ${idToken}` },
        }
      );
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

  const plans: DdosPlan[] = data.plans || [];
  const attacks: DdosAttack[] = data.recentAttacks || [];
  const recommendations: string[] = data.recommendations || [];

  return (
    <div className="p-6 w-full animate-in fade-in duration-500 space-y-6">
      {/* Risk Level Banner */}
      <div
        className={`rounded-lg border p-4 ${getRiskColor(data.riskLevel)} flex items-start justify-between`}
      >
        <div className="flex items-start gap-3 flex-1">
          <Shield className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div>
            <h2 className="font-bold text-sm">Postura DDoS</h2>
            <p className="text-xs mt-1">
              Nivel de Riesgo: <span className="font-bold">{data.riskLevel}</span> • Cobertura:{" "}
              <span className="font-bold">{data.coveragePercentage}%</span>
            </p>
          </div>
        </div>
      </div>

      {/* KPIs Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
            Costo Mensual
          </h3>
          <p className="text-2xl font-bold text-brand-deep">{fmt.format(data.totalMonthlyCost)}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {data.activePlans} plan{data.activePlans !== 1 ? "es" : ""}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1 flex items-center gap-1">
            <Shield className="w-4 h-4" />
            VNets Protegidas
          </h3>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{data.protectedVnets}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {data.unprotectedResources} sin protección
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1 flex items-center gap-1">
            <Activity className="w-4 h-4" />
            Ataques Mitigados
          </h3>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
            {data.attacksMitigated}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            de {data.totalAttacksDetected} detectados
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1 flex items-center gap-1">
            <Clock className="w-4 h-4" />
            Último Ataque
          </h3>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {data.dayssinceLastAttack}d
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">hace {data.dayssinceLastAttack} días</p>
        </div>
      </div>

      {/* Plans Overview */}
      {plans.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Planes DDoS Activos</h2>
          <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
            {plans.map((plan) => (
              <div
                key={plan.planId}
                className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-800 p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-bold text-gray-900 dark:text-white text-sm">{plan.planName}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{plan.region}</p>
                  </div>
                  <span className="text-xs font-semibold px-2 py-1 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    {plan.status}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-sm mb-3">
                  <div>
                    <span className="text-xs text-gray-600 dark:text-gray-400">VNets</span>
                    <p className="font-bold text-gray-900 dark:text-white">{plan.protectedVnets}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-600 dark:text-gray-400">Public IPs</span>
                    <p className="font-bold text-gray-900 dark:text-white">{plan.protectedPublicIps}</p>
                  </div>
                  <div>
                    <span className="text-xs text-gray-600 dark:text-gray-400">Apps</span>
                    <p className="font-bold text-gray-900 dark:text-white">{plan.protectedApplications}</p>
                  </div>
                </div>

                <div className="pt-3 border-t border-gray-200 dark:border-slate-700">
                  <p className="text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Costo mensual:</span>
                    <span className="font-bold text-brand-deep ml-2">
                      {plan.costPerMonth > 0 ? fmt.format(plan.costPerMonth) : "Heredado"}
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Attacks */}
      {attacks.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Ataques Detectados Recientemente</h2>
          <div className="space-y-3">
            {attacks.map((attack) => (
              <div
                key={attack.id}
                className={`rounded-lg border p-4 cursor-pointer hover:shadow-md transition-shadow ${getAttackTypeColor(
                  attack.type
                )}`}
                onClick={() => setExpandedAttack(expandedAttack === attack.id ? null : attack.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      {attack.type}
                    </h3>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      {new Date(attack.startTime).toLocaleString()} • Duración:{" "}
                      <span className="font-semibold">{attack.duration} min</span>
                    </p>
                  </div>
                  <div className="text-right ml-4">
                    <span
                      className={`text-xs px-2 py-1 rounded font-semibold ${
                        attack.mitigationStatus === "Mitigated"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                      }`}
                    >
                      {attack.mitigationStatus}
                    </span>
                  </div>
                  <ChevronDown
                    className={`w-5 h-5 text-gray-400 ml-2 transition-transform ${
                      expandedAttack === attack.id ? "rotate-180" : ""
                    }`}
                  />
                </div>

                {expandedAttack === attack.id && (
                  <div className="mt-4 pt-4 border-t border-gray-300 dark:border-slate-600 space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-xs text-gray-600 dark:text-gray-400">Pico de Tráfico</span>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">
                          {attack.peakTrafficGbps.toFixed(1)} Gbps
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-gray-600 dark:text-gray-400">Paquetes/seg</span>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">
                          {numfmt.format(attack.packetsPerSecond)}/s
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-gray-600 dark:text-gray-400">Bytes Descartados</span>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">
                          {(attack.bytesDropped / 1000000000).toFixed(2)} GB
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-gray-600 dark:text-gray-400 flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          Origen
                        </span>
                        <p className="text-sm font-bold text-gray-900 dark:text-white">
                          {attack.sourceCountries.join(", ")}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h3 className="font-bold text-blue-900 dark:text-blue-300 mb-3 flex items-center gap-2">
            <TrendingDown className="w-4 h-4" />
            Recomendaciones de Optimización
          </h3>
          <ul className="space-y-2">
            {recommendations.map((rec, idx) => (
              <li key={idx} className="text-sm text-blue-800 dark:text-blue-200 flex gap-2">
                <span className="text-blue-500 flex-shrink-0">✓</span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
