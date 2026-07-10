"use client";
import React, { useState } from "react";
import useSWR from "swr";
import { useTenant } from "@/components/TenantProvider";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Network, AlertCircle, Info, DollarSign, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { isMockTenant } from "@/lib/mockData";
import { getFreshIdToken } from "@/lib/msalToken";

type ZombieItem = {
    resourceId: string;
    resourceName: string;
    resourceType: string;
    armType: string;
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

const PAGE_SIZE = 15;

export default function NetworkingZombiesPanel() {
    const tm = useTranslations("Mock");
    const { selectedTenant } = useTenant();
    const { instance, accounts } = useMsal();
    const [pageIndex, setPageIndex] = useState(0);
    const [deletingId, setDeletingId] = useState<string | null>(null);

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

    const { data, error, isLoading, mutate } = useSWR(
        selectedTenant && selectedTenant.id !== "default" && (accounts.length > 0 || isMockTenant(selectedTenant.id))
            ? `/api/cleanup/zombies/networking?tenantId=${selectedTenant.id}`
            : null,
        fetcher,
        { revalidateOnFocus: false }
    );

    const handleDelete = async (item: ZombieItem) => {
        if (!selectedTenant) return;
        if (!window.confirm(`¿Estás completamente seguro de ELIMINAR el recurso ${item.resourceName} (${item.resourceType}) permanentemente? Esto impactará los costos en Azure al instante.`)) return;

        try {
            setDeletingId(item.resourceId);
            const idToken = await getFreshIdToken(instance, accounts[0]);
            const res = await fetch("/api/remediation", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${idToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    tenantId: selectedTenant.id,
                    subscriptionId: item.subscriptionId,
                    resourceGroup: item.resourceGroup,
                    resourceName: item.resourceName,
                    resourceType: item.armType,
                    resourceId: item.resourceId,
                }),
            });

            const json = await res.json();
            if (!res.ok) {
                if (json.error === "MISSING_CONTRIBUTOR_ROLE") {
                    toast.error("¡Operación Denegada!", { description: "Tu aplicación FinOps solo tiene rol de Lector o faltan permisos en la suscripción." });
                    return;
                }
                throw new Error(json.error || "Fallo al eliminar");
            }

            await mutate((prev: any) => {
                if (!prev) return prev;
                const items = (prev.items || []).filter((r: ZombieItem) => r.resourceId !== item.resourceId);
                const totalMonthlyWaste = Number(items.reduce((sum: number, r: ZombieItem) => sum + r.monthlyCost, 0).toFixed(2));
                return { ...prev, items, totalMonthlyWaste };
            }, { revalidate: false });

            toast.success("Recurso Eliminado", { description: `${item.resourceName} fue destruido.` });
        } catch (err: any) {
            toast.error("Error al borrar", { description: err.message });
        } finally {
            setDeletingId(null);
        }
    };

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

    const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const safePageIndex = Math.min(pageIndex, pageCount - 1);
    const pageItems = items.slice(safePageIndex * PAGE_SIZE, safePageIndex * PAGE_SIZE + PAGE_SIZE);

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
                    <>
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
                                        <th className="px-4 py-3 font-semibold text-right">Acción</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-slate-800/50">
                                    {pageItems.map((item) => (
                                        <tr key={item.resourceId} className="hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors">
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
                                            <td className="px-4 py-3 text-right">
                                                <button
                                                    onClick={() => handleDelete(item)}
                                                    disabled={deletingId === item.resourceId}
                                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                                    title={`Eliminar ${item.resourceName}`}
                                                >
                                                    {deletingId === item.resourceId ? (
                                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    ) : (
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    )}
                                                    Eliminar
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        <div className="px-4 py-3 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                            <span>
                                Mostrando {safePageIndex * PAGE_SIZE + 1}–{Math.min(items.length, safePageIndex * PAGE_SIZE + PAGE_SIZE)} de {items.length}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                                    disabled={safePageIndex === 0}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-semibold bg-gray-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                                </button>
                                <span className="px-2 font-medium text-slate-700 dark:text-slate-200">
                                    Página {safePageIndex + 1} de {pageCount}
                                </span>
                                <button
                                    onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
                                    disabled={safePageIndex >= pageCount - 1}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-semibold bg-gray-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    Siguiente <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
