"use client";
import React from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { Loader2, Network, AlertCircle, Info, DollarSign } from "lucide-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";

type ZombieItem = {
    resourceId: string;
    resourceName: string;
    resourceType: string;
    resourceGroup: string;
    subscriptionId: string;
    monthlyCost: number;
    reason: string;
    daysIdle: number;
};

const TYPE_BADGE: Record<string, string> = {
    applicationGateway:       "bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400",
    loadBalancer:             "bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-400",
    virtualNetworkGateway:    "bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400",
    virtualNetwork:           "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
    subnet:                   "bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400",
    virtualWanHub:            "bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400",
    routeServer:              "bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400",
    expressRouteCircuit:      "bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400",
    vnetPeering:              "bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400",
    azureFirewall:            "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400",
    networkSecurityGroup:     "bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400",
    applicationSecurityGroup: "bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-400",
    privateEndpoint:          "bg-fuchsia-100 dark:bg-fuchsia-950/40 text-fuchsia-700 dark:text-fuchsia-400",
    privateDnsZone:           "bg-fuchsia-100 dark:bg-fuchsia-950/40 text-fuchsia-700 dark:text-fuchsia-400",
    dnsZone:                  "bg-fuchsia-100 dark:bg-fuchsia-950/40 text-fuchsia-700 dark:text-fuchsia-400",
    bastionHost:              "bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400",
    ddosProtectionPlan:       "bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400",
    webApplicationFirewall:   "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400",
    frontDoor:                "bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400",
    trafficManager:           "bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400",
    natGateway:               "bg-lime-100 dark:bg-lime-950/40 text-lime-700 dark:text-lime-400",
    networkWatcher:           "bg-slate-100 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300",
    trafficAnalytics:         "bg-slate-100 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300",
};

export default function NetworkingZombiesPanel() {
    const tm = useTranslations("Mock");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();

    const fetcher = async (url: string) => {
        const idToken = await getFreshIdToken(instance, accounts[0]);
        const res = await fetch(url, {
            headers: { Authorization: `Bearer ${idToken}` },
        });
        if (!res.ok) {
            const json = await res.json();
            throw new Error(json.error || "Error al cargar datos");
        }
        return res.json();
    };

    const { data, error, isLoading } = useSWR(
        selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/cleanup/zombies/networking?tenantId=${selectedTenant.id}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    if (!selectedTenant || selectedTenant.id === "default") return null;

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-brand-deep mb-4" />
                <p className="text-gray-500 dark:text-gray-400">Detectando recursos de red zombies...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg border border-red-100 dark:border-red-900/50">
                <h3 className="font-bold flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Error</h3>
                <p className="text-sm">{error.message}</p>
            </div>
        );
    }

    if (!data) return null;

    const items: ZombieItem[] = data.items || [];
    const totalWaste: number = data.totalMonthlyWaste || 0;

    return (
        <div className="w-full space-y-6">
            {/* Mock banner */}
            {data.mock && (
                <div className="bg-amber-50 dark:bg-amber-900/20 p-3 flex gap-3 rounded-xl border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300">
                    <Info className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="text-sm">
                        <span className="font-bold mr-2 px-1.5 py-0.5 bg-amber-200 dark:bg-amber-800 rounded text-xs">{tm("badge")}</span>
                        {tm("description")}
                    </div>
                </div>
            )}

            {/* Summary KPI */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Recursos Detectados</p>
                    <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{items.length}</p>
                    <p className="text-xs text-slate-400 mt-1">VNet, vWAN, ExpressRoute, Firewall, Bastion, Front Door, DNS y más</p>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                        <DollarSign className="w-3 h-3" />
                        Desperdicio Mensual
                    </p>
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">${totalWaste.toFixed(2)}</p>
                    <p className="text-xs text-slate-400 mt-1">costo mensual acumulado</p>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-5">
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Ahorro Anual Estimado</p>
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">${(totalWaste * 12).toFixed(2)}</p>
                    <p className="text-xs text-slate-400 mt-1">si se eliminan todos</p>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800 flex items-center gap-2">
                    <Network className="w-4 h-4 text-cyan-500" />
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Recursos de Red Zombies</h3>
                    <span className="ml-auto text-xs font-medium px-2 py-0.5 bg-gray-100 dark:bg-slate-800 text-gray-500 rounded-full">
                        {items.length}
                    </span>
                </div>
                {items.length === 0 ? (
                    <div className="py-16 text-center text-slate-500 dark:text-slate-400">
                        <Network className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="font-medium">No se detectaron recursos de red zombies</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-gray-50 dark:bg-slate-800/50 text-xs text-slate-500 dark:text-slate-400">
                                <tr>
                                    <th className="px-4 py-3 font-semibold">Recurso</th>
                                    <th className="px-4 py-3 font-semibold">Tipo</th>
                                    <th className="px-4 py-3 font-semibold">Resource Group</th>
                                    <th className="px-4 py-3 font-semibold">Motivo</th>
                                    <th className="px-4 py-3 font-semibold text-right">Días Idle</th>
                                    <th className="px-4 py-3 font-semibold text-right">Costo/Mes</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
                                {items.map((item, i) => (
                                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
                                        <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200 max-w-[220px] truncate" title={item.resourceName}>
                                            {item.resourceName}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${TYPE_BADGE[item.resourceType] || "bg-gray-100 text-gray-600"}`}>
                                                {item.resourceType}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 font-mono">{item.resourceGroup}</td>
                                        <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300 max-w-[200px] truncate" title={item.reason}>
                                            {item.reason}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${item.daysIdle >= 30 ? "bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400" : "bg-yellow-100 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400"}`}>
                                                {item.daysIdle}d
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-semibold text-red-600 dark:text-red-400">
                                            ${item.monthlyCost.toFixed(2)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
