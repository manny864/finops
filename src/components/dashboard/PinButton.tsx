"use client";
import React, { useState, useCallback } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { useMsal } from "@azure/msal-react";
import { useTenant } from "@/components/TenantProvider";
import { Pin, PinOff, Check, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface PinButtonProps {
    widgetKey: string;
    label?: string;
    compact?: boolean;
}

export default function PinButton({ widgetKey, label, compact = false }: PinButtonProps) {
    const { instance, accounts } = useMsal();
    const { selectedTenant } = useTenant();
    const [busy, setBusy] = useState(false);
    const [justToggled, setJustToggled] = useState<"pinned" | "unpinned" | null>(null);
    const [lastError, setLastError] = useState<string | null>(null);

    const apiUrl = selectedTenant && selectedTenant.id !== "default"
        ? `/api/dashboard/pins?tenantId=${selectedTenant.id}`
        : null;

    const fetcher = useCallback(async (url: string) => {
        const account = accounts[0];
        if (!account) throw new Error("No hay cuenta autenticada");
        const tok = await instance.acquireTokenSilent({ scopes: ["User.Read"], account });
        const res = await fetch(url, { headers: { Authorization: `Bearer ${tok.idToken}` } });
        if (!res.ok) return { pins: [] };
        return res.json();
    }, [instance, accounts]);

    const { data } = useSWR(apiUrl, fetcher, { revalidateOnFocus: false });
    const isPinned = Array.isArray(data?.pins) && data.pins.some((p: any) => p.widgetKey === widgetKey);

    const toggle = useCallback(async () => {
        if (!selectedTenant || selectedTenant.id === "default" || !accounts[0]) return;
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
                toast.error(`No se pudo ${isPinned ? "despinear" : "pinear"}: ${msg}`);
                console.error("[PinButton] backend rejected:", body);
                return;
            }
            setJustToggled(isPinned ? "unpinned" : "pinned");
            toast.success(isPinned ? "Widget removido del dashboard" : "Widget agregado a Mi Dashboard. Andá al dashboard principal para verlo.");
            if (apiUrl) await globalMutate(apiUrl);
            setTimeout(() => setJustToggled(null), 1800);
        } catch (e: any) {
            const msg = e?.message || "error desconocido";
            setLastError(msg);
            toast.error(`Error: ${msg}`);
            console.error("[PinButton] toggle failed:", e);
        } finally {
            setBusy(false);
        }
    }, [accounts, instance, isPinned, selectedTenant, widgetKey, apiUrl]);

    if (!selectedTenant || selectedTenant.id === "default") return null;

    const tooltip = label || (isPinned ? "Quitar del dashboard" : "Pinear al dashboard");
    const sizeCls = compact ? "px-1.5 py-1" : "px-2.5 py-1.5";
    const iconSize = compact ? "w-3.5 h-3.5" : "w-4 h-4";

    return (
        <button
            type="button"
            onClick={toggle}
            disabled={busy}
            title={lastError ? `Error: ${lastError}` : tooltip}
            aria-label={tooltip}
            aria-pressed={isPinned}
            className={`inline-flex items-center justify-center gap-1 ${sizeCls} rounded-md border transition-colors
                ${lastError
                    ? "bg-red-50 text-red-700 border-red-300 hover:bg-red-100"
                    : isPinned
                        ? "bg-brand-deep text-white border-brand-deep hover:bg-brand-deep/90"
                        : "text-brand-deep border-brand-deep/30 bg-white dark:bg-slate-800 hover:bg-brand-deep/5 dark:hover:bg-brand-deep/20"}
                disabled:opacity-50 disabled:cursor-not-allowed shadow-sm font-medium text-xs`}
        >
            {busy
                ? <Loader2 className={`${iconSize} animate-spin`} />
                : lastError
                    ? <AlertCircle className={iconSize} />
                    : justToggled
                        ? <Check className={`${iconSize} text-emerald-500`} />
                        : isPinned
                            ? <PinOff className={iconSize} />
                            : <Pin className={iconSize} />}
            {!compact && <span>{lastError ? "Error" : isPinned ? "Pineado" : "Pinear"}</span>}
        </button>
    );
}
