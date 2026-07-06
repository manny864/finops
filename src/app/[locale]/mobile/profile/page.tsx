"use client";
/**
 * Perfil móvil: misma funcionalidad que el menú de perfil del header
 * (nombre editable, email, rol, moneda, aspecto, logout) como pantalla
 * completa mobile-first, más el toggle a la versión de escritorio.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMsal } from "@azure/msal-react";
import { useTheme } from "next-themes";
import { useRouter } from "@/i18n/routing";
import { getFreshIdToken } from "@/lib/msalToken";
import { useTenant } from "@/components/TenantProvider";
import { CurrencySelector } from "@/components/CurrencyProvider";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import ScopeSelector from "@/components/ScopeSelector";
import { Pencil, Check, X, LogOut, Sun, Moon, Monitor, Loader2, MonitorSmartphone } from "lucide-react";
import { toast } from "sonner";

export default function MobileProfilePage() {
    const t = useTranslations("Profile");
    const tm = useTranslations("Mobile");
    const { instance, accounts } = useMsal();
    const { userRole, selectedTenant } = useTenant();
    const { theme, setTheme } = useTheme();
    const router = useRouter();

    const [displayName, setDisplayName] = useState<string | null>(null);
    const [role, setRole] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [nameDraft, setNameDraft] = useState("");
    const [saving, setSaving] = useState(false);
    const [mounted, setMounted] = useState(false);

    useEffect(() => { setMounted(true); }, []);

    const account = accounts[0];
    const shownName = displayName || account?.name || account?.username || "";
    const initial = (shownName || "U").charAt(0).toUpperCase();

    const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (!account) return {};
        const token = await getFreshIdToken(instance, account);
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [instance, account]);

    useEffect(() => {
        if (!account) return;
        let cancelled = false;
        (async () => {
            try {
                const headers = await authHeaders();
                const res = await fetch("/api/profile", { headers });
                if (!res.ok) return;
                const json = await res.json();
                if (!cancelled && json.profile) {
                    if (json.profile.displayName) setDisplayName(json.profile.displayName);
                    if (json.profile.role) setRole(json.profile.role);
                }
            } catch { /* datos del token como fallback */ }
        })();
        return () => { cancelled = true; };
    }, [account, authHeaders]);

    const saveName = async () => {
        const name = nameDraft.trim();
        if (name.length < 2 || saving) return;
        setSaving(true);
        try {
            const headers = await authHeaders();
            const res = await fetch("/api/profile", {
                method: "PATCH",
                headers: { ...headers, "Content-Type": "application/json" },
                body: JSON.stringify({ displayName: name }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error);
            setDisplayName(name);
            setEditing(false);
            toast.success(t("nameSaved"));
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : t("errorGeneric"));
        } finally {
            setSaving(false);
        }
    };

    const handleLogout = () => {
        instance.logoutRedirect({
            postLogoutRedirectUri: typeof window !== "undefined" ? window.location.origin : "/",
        }).catch(e => console.error(e));
    };

    const goDesktop = () => {
        sessionStorage.setItem("finops:forceDesktop", "1");
        router.push("/");
    };

    const themeOptions = [
        { value: "light", label: t("themeLight"), icon: Sun },
        { value: "dark", label: t("themeDark"), icon: Moon },
        { value: "system", label: t("themeAuto"), icon: Monitor },
    ] as const;

    return (
        <div className="max-w-lg mx-auto">
            {/* Identidad */}
            <div className="flex flex-col items-center pt-4 pb-6">
                <div className="w-20 h-20 rounded-full bg-[var(--color-primary)] flex items-center justify-center text-white font-bold text-3xl shadow-md">
                    {initial}
                </div>
                {editing ? (
                    <div className="flex items-center gap-2 mt-3 w-full max-w-xs">
                        <input
                            value={nameDraft}
                            onChange={(e) => setNameDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") saveName(); }}
                            maxLength={255}
                            autoFocus
                            className="flex-1 min-w-0 border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-base bg-transparent text-ink dark:text-white outline-none focus:border-brand-deep text-center"
                        />
                        <button onClick={saveName} disabled={saving || nameDraft.trim().length < 2} aria-label={t("save")} className="p-2 text-green-600 disabled:opacity-40">
                            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                        </button>
                        <button onClick={() => setEditing(false)} disabled={saving} aria-label={t("cancel")} className="p-2 text-gray-400">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                ) : (
                    <button onClick={() => { setNameDraft(shownName); setEditing(true); }} className="flex items-center gap-2 mt-3">
                        <span className="text-xl font-bold text-ink dark:text-white">{shownName}</span>
                        <Pencil className="w-4 h-4 text-gray-400" />
                    </button>
                )}
                <p className="text-sm text-ink-soft dark:text-gray-400 mt-1">{account?.username}</p>
                <span className="mt-2 text-xs font-bold uppercase tracking-wide px-3 py-1 rounded-full bg-brand-soft text-brand-deep dark:bg-slate-800 dark:text-brand-sky">
                    {role || userRole}{selectedTenant?.name ? ` · ${selectedTenant.name}` : ""}
                </span>
            </div>

            <div className="flex flex-col gap-3">
                {/* Ámbito: tenant (superadmin), suscripción (usuarios) o demo a ver */}
                <div className="rounded-2xl border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 p-4">
                    <label className="block text-sm font-bold text-ink dark:text-white mb-2">{tm("scope")}</label>
                    <ScopeSelector mobile />
                </div>

                {/* Moneda */}
                <div className="rounded-2xl border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 p-4">
                    <label className="block text-sm font-bold text-ink dark:text-white mb-2">{t("currency")}</label>
                    <CurrencySelector className="w-full border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-3 text-base bg-white dark:bg-slate-800 dark:text-gray-100" />
                </div>

                {/* Idioma (en móvil no está en el header) */}
                <div className="rounded-2xl border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 p-4">
                    <label className="block text-sm font-bold text-ink dark:text-white mb-2">{tm("language")}</label>
                    <LanguageSwitcher />
                </div>

                {/* Aspecto */}
                <div className="rounded-2xl border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 p-4">
                    <label className="block text-sm font-bold text-ink dark:text-white mb-2">{t("appearance")}</label>
                    <div className="grid grid-cols-3 gap-2">
                        {themeOptions.map(({ value, label, icon: Icon }) => (
                            <button
                                key={value}
                                onClick={() => setTheme(value)}
                                className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border text-sm font-semibold transition-colors ${mounted && theme === value
                                    ? "border-brand-deep bg-brand-soft/60 text-brand-deep dark:bg-slate-800 dark:text-brand-sky"
                                    : "border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300"}`}
                            >
                                <Icon className="w-5 h-5" />
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Versión de escritorio */}
                <button onClick={goDesktop} className="flex items-center justify-center gap-2 rounded-2xl border border-line dark:border-slate-800 bg-surface dark:bg-slate-900 p-4 text-base font-bold text-ink dark:text-white active:bg-surface-2">
                    <MonitorSmartphone className="w-5 h-5" /> {tm("goDesktop")}
                </button>

                {/* Salir */}
                <button onClick={handleLogout} className="flex items-center justify-center gap-2 rounded-2xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/40 p-4 text-base font-bold text-red-600 active:bg-red-100">
                    <LogOut className="w-5 h-5" /> {t("logout")}
                </button>
            </div>
        </div>
    );
}
