"use client";
import React, { useState, useCallback } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { useTenant } from "@/components/TenantProvider";
import { IconPin, IconPinFilled, IconCheck, IconLoader2, IconAlertCircle } from "@tabler/icons-react";
import { toast } from "sonner";
import { isMockTenant } from "@/lib/mockData";
import { errorMessage } from '@/lib/apiErrors';

const DEMO_PINS_KEY = "finops_demo_dashboard_pins";

interface PinButtonProps {
    widgetKey: string;
    label?: string;
    compact?: boolean;
}

export default function PinButton({ widgetKey, label, compact = false }: PinButtonProps) {
    const t = useTranslations("MyDashboard");
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const [busy, setBusy] = useState(false);
    const [justToggled, setJustToggled] = useState<"pinned" | "unpinned" | null>(null);
    const [lastError, setLastError] = useState<string | null>(null);
    const [demoPins, setDemoPins] = useState<string[]>(() => {
        if (typeof window === "undefined") return [];
        try { return JSON.parse(localStorage.getItem(DEMO_PINS_KEY) || "[]"); } catch { return []; }
    });
    const isDemo = Boolean(selectedTenant?.id && isMockTenant(selectedTenant.id));

    const apiUrl = selectedTenant && selectedTenant.id !== "default"
        ? `/api/dashboard/pins?tenantId=${selectedTenant.id}`
        : null;

    const fetcher = useCallback(async (url: string) => {
        const account = accounts[0];
        if (!account) throw new Error(t("noAuthAccount"));
        const tok = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });
        const res = await fetch(url, { headers: { Authorization: `Bearer ${tok.idToken}` } });
        if (!res.ok) return { pins: [] };
        return res.json();
    }, [instance, accounts]);

    const { data } = useSWR(apiUrl, fetcher, { revalidateOnFocus: false });
    const isPinned = isDemo
        ? demoPins.includes(widgetKey)
        : Array.isArray(data?.pins) && data.pins.some((p: any) => p.widgetKey === widgetKey);

    const toggle = useCallback(async () => {
        if (!selectedTenant || selectedTenant.id === "default") return;
        if (isDemo) {
            const next = isPinned ? demoPins.filter((key) => key !== widgetKey) : [...demoPins, widgetKey];
            localStorage.setItem(DEMO_PINS_KEY, JSON.stringify(next));
            setDemoPins(next);
            window.dispatchEvent(new CustomEvent("finops-demo-pins-updated", { detail: next }));
            toast.success(isPinned ? t("pinRemoved") : t("pinAdded"));
            return;
        }
        if (!accounts[0]) return;
        setBusy(true);
        setLastError(null);
        try {
            const tok = await instance.acquireTokenSilent({ scopes: ["User.Read"], account: accounts[0] });
            const headers = { Authorization: `Bearer ${tok.idToken}`, "Content-Type": "application/json" };
            let res: Response;
            if (isPinned) {
                res = await fetch(`/api/dashboard/pins?tenantId=${selectedTenant.id}&widgetKey=${encodeURIComponent(widgetKey)}`, {
                    method: "DELETE", headers,
                });
            } else {
                res = await fetch(`/api/dashboard/pins?tenantId=${selectedTenant.id}`, {
                    method: "POST", headers, body: JSON.stringify({ widgetKey }),
                });
            }
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body?.success === false) {
                const msg = body?.error || `HTTP ${res.status}`;
                setLastError(msg);
                toast.error(isPinned ? t("pinFailed", { error: msg }) : t("unpinFailed", { error: msg }));
                console.error("[PinButton] backend rejected:", body);
                return;
            }
            setJustToggled(isPinned ? "unpinned" : "pinned");
            toast.success(isPinned ? t("pinRemoved") : t("pinAddedHint"));
            if (apiUrl) await globalMutate(apiUrl);
            setTimeout(() => setJustToggled(null), 1800);
        } catch (e) {
            const msg = errorMessage(e) || t("unknownError");
            setLastError(msg);
            toast.error(t("genericError", { error: msg }));
            console.error("[PinButton] toggle failed:", e);
        } finally {
            setBusy(false);
        }
    }, [accounts, instance, isPinned, selectedTenant, widgetKey, apiUrl, isDemo, demoPins]);

    if (!selectedTenant || selectedTenant.id === "default") return null;

    const tooltip = label || (isPinned ? t("unpinFromDashboard") : t("pinToDashboard"));
    const sizeCls = compact ? "w-7 h-7" : "w-8 h-8";
    const iconSize = compact ? 16 : 18;

    return (
        <button
            type="button"
            onClick={toggle}
            disabled={busy}
            title={lastError ? `Error: ${lastError}` : tooltip}
            aria-label={tooltip}
            aria-pressed={isPinned}
            className={`inline-flex items-center justify-center ${sizeCls} rounded-lg border transition-all duration-200
                ${lastError
                    ? "bg-red-50 text-red-700 border-red-300 hover:bg-red-100"
                    : isPinned
                        ? "bg-brand-soft text-brand-deep border-brand-deep/40 hover:bg-brand-deep hover:text-white dark:bg-brand-deep/20 dark:text-brand-bright dark:border-brand-deep/50"
                        : "bg-surface text-brand-deep border-line hover:border-brand-deep hover:bg-brand-soft/60 dark:bg-surface dark:text-brand-bright dark:hover:bg-brand-deep/20"}
                disabled:opacity-50 disabled:cursor-not-allowed shadow-sm`}
        >
            {busy ? (
                <IconLoader2 size={iconSize} className="animate-spin text-brand-deep dark:text-brand-bright" />
            ) : lastError ? (
                <IconAlertCircle size={iconSize} className="text-red-600" />
            ) : justToggled ? (
                <IconCheck size={iconSize} className="text-emerald-600" strokeWidth={2.5} />
            ) : isPinned ? (
                <IconPinFilled size={iconSize} className="text-brand-deep dark:text-brand-bright" />
            ) : (
                <IconPin size={iconSize} strokeWidth={1.8} className="text-brand-deep dark:text-brand-bright" />
            )}
        </button>
    );
}
