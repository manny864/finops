"use client";
import React, { useCallback } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { useTenant } from "@/components/TenantProvider";
import { LayoutDashboard, PinOff, ChevronUp, ChevronDown } from "lucide-react";
import { getWidget } from "./widgetRegistry";
import { getRequiredTierForPath } from "@/lib/routeTiers";
import FeatureGuard from "@/components/FeatureGuard";
import { isMockTenant } from "@/lib/mockData";

const DEMO_PINS_KEY = "finops_demo_dashboard_pins";

interface PinRow {
    widgetKey: string;
    position: number;
    settings: any;
}

/**
 * Sección "Mi Dashboard": renderiza los widgets que el usuario pineó en la
 * sesión actual. Si no hay nada pineado, muestra un placeholder educativo.
 *
 * Pensado para vivir al tope de la página principal del dashboard (`/`).
 * Es totalmente opcional — si no se monta, la página sigue funcionando igual.
 */
export default function MyPinnedWidgets() {
    const t = useTranslations("MyDashboard");
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const [collapsed, setCollapsed] = React.useState(false);
    const isDemo = Boolean(selectedTenant?.id && isMockTenant(selectedTenant.id));
    const [demoPins, setDemoPins] = React.useState<string[]>(() => {
        if (typeof window === "undefined") return [];
        try { return JSON.parse(localStorage.getItem(DEMO_PINS_KEY) || "[]"); } catch { return []; }
    });

    React.useEffect(() => {
        if (!isDemo) return;
        const sync = (event: Event) => {
            const detail = (event as CustomEvent<string[]>).detail;
            if (Array.isArray(detail)) setDemoPins(detail);
        };
        window.addEventListener("finops-demo-pins-updated", sync);
        return () => window.removeEventListener("finops-demo-pins-updated", sync);
    }, [isDemo]);

    const apiUrl = selectedTenant && selectedTenant.id !== "default" && accounts.length > 0
        ? `/api/dashboard/pins?tenantId=${selectedTenant.id}`
        : null;

    const fetcher = useCallback(async (url: string) => {
        const account = accounts[0];
        if (!account) throw new Error(t("no_authenticated_account"));
        const tok = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });
        const res = await fetch(url, { headers: { Authorization: `Bearer ${tok.idToken}` } });
        if (!res.ok) return { pins: [] };
        return res.json();
    }, [instance, accounts]);

    const { data, isLoading } = useSWR(apiUrl, fetcher, {
        revalidateOnFocus: true,
        revalidateOnMount: true,
        refreshInterval: 0,
    });
    const pins: PinRow[] = isDemo
        ? demoPins.map((widgetKey, position) => ({ widgetKey, position, settings: null }))
        : Array.isArray(data?.pins) ? data.pins : [];

    const unpin = useCallback(async (widgetKey: string) => {
        if (!selectedTenant) return;
        if (isDemo) {
            const next = demoPins.filter((key) => key !== widgetKey);
            localStorage.setItem(DEMO_PINS_KEY, JSON.stringify(next));
            setDemoPins(next);
            window.dispatchEvent(new CustomEvent("finops-demo-pins-updated", { detail: next }));
            return;
        }
        if (!accounts[0]) return;
        const tok = await instance.acquireTokenSilent({ scopes: ["User.Read"], account: accounts[0] });
        await fetch(`/api/dashboard/pins?tenantId=${selectedTenant.id}&widgetKey=${encodeURIComponent(widgetKey)}`, {
            method: "DELETE", headers: { Authorization: `Bearer ${tok.idToken}` },
        });
        if (apiUrl) await globalMutate(apiUrl);
    }, [accounts, instance, selectedTenant, apiUrl, isDemo, demoPins]);

    if (!selectedTenant || selectedTenant.id === "default") return null;
    if (isLoading) return null; // Silent loading — no flicker

    // Collapse to 0px when no widgets are pinned
    if (pins.length === 0) return null;

    return (
        <section className="mb-8">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <LayoutDashboard className="w-5 h-5 text-brand-deep" />
                    <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{t("title")}</h2>
                    <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-full text-xs font-semibold text-slate-500">
                        {pins.length} {pins.length === 1 ? t("widget") : t("widgets")}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={() => setCollapsed(c => !c)}
                    className="text-xs font-semibold text-slate-500 hover:text-brand-deep flex items-center gap-1 px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                    {collapsed ? <><ChevronDown className="w-3.5 h-3.5" /> {t("expand")}</> : <><ChevronUp className="w-3.5 h-3.5" /> {t("collapse")}</>}
                </button>
            </div>

            {!collapsed && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {pins
                        .slice()
                        .sort((a, b) => a.position - b.position)
                        .map(pin => {
                            const def = getWidget(pin.widgetKey);
                            if (!def) return null;
                            const W = def.Component;
                            const requiredTier = getRequiredTierForPath(def.sourcePage);
                            return (
                                <div key={pin.widgetKey} className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden">
                                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/30">
                                        <div className="min-w-0">
                                            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{def.title}</h3>
                                            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{def.description}</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => unpin(pin.widgetKey)}
                                            title={t("unpin_tooltip")}
                                            className="ml-2 p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors cursor-pointer"
                                        >
                                            <PinOff className="w-4 h-4" />
                                        </button>
                                    </div>
                                    <div className="p-3" style={{ minHeight: `${def.minHeightRem || 20}rem` }}>
                                        {requiredTier ? (
                                            <FeatureGuard requiredTier={requiredTier} featureName={def.title}>
                                                <W />
                                            </FeatureGuard>
                                        ) : <W />}
                                    </div>
                                </div>
                            );
                        })}
                </div>
            )}
        </section>
    );
}
