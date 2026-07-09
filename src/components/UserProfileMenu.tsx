"use client";
/**
 * Menú de perfil del usuario (header): solo el avatar como disparador — en
 * móvil el botón de logout separado quedaba fuera de pantalla. El dropdown
 * contiene: nombre completo (editable), email, rol, selector de moneda,
 * aspecto (claro/oscuro/automático) y cerrar sesión.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useMsal } from "@azure/msal-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { getFreshIdToken, getGraphAccessToken } from "@/lib/msalToken";
import { useTenant } from "@/components/TenantProvider";
import { CurrencySelector } from "@/components/CurrencyProvider";
import { Pencil, Check, X, LogOut, Sun, Moon, Monitor, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function UserProfileMenu() {
    const t = useTranslations("Profile");
    const { instance, accounts } = useMsal();
    const { userRole } = useTenant();
    const { theme, setTheme } = useTheme();

    const [open, setOpen] = useState(false);
    const [displayName, setDisplayName] = useState<string | null>(null);
    const [role, setRole] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [nameDraft, setNameDraft] = useState("");
    const [saving, setSaving] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [photoUrl, setPhotoUrl] = useState<string | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    // next-themes: theme solo es confiable tras montar (evita mismatch SSR).
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
            } catch {
                // Silencioso: el menú funciona con los datos del token.
            }
        })();
        return () => { cancelled = true; };
    }, [account, authHeaders]);

    // Foto de perfil desde Microsoft Graph (Azure AD). 404 = usuario sin foto
    // configurada en Entra ID: se mantiene el fallback de iniciales.
    useEffect(() => {
        if (!account) return;
        let cancelled = false;
        let objectUrl: string | null = null;
        (async () => {
            try {
                const accessToken = await getGraphAccessToken(instance, account);
                if (!accessToken) return;
                const res = await fetch("https://graph.microsoft.com/v1.0/me/photo/$value", {
                    headers: { Authorization: `Bearer ${accessToken}` },
                });
                if (!res.ok || cancelled) return;
                const blob = await res.blob();
                if (cancelled) return;
                objectUrl = URL.createObjectURL(blob);
                setPhotoUrl(objectUrl);
            } catch {
                // Sin foto en Entra ID o Graph no accesible: se usan iniciales.
            }
        })();
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [account, instance]);

    // Cerrar con click afuera o Escape.
    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
        document.addEventListener("mousedown", onClick);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onClick);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

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
        }).catch(e => console.error("Error al iniciar logout:", e));
    };

    if (!account) return null;

    const themeOptions = [
        { value: "light", label: t("themeLight"), icon: Sun },
        { value: "dark", label: t("themeDark"), icon: Moon },
        { value: "system", label: t("themeAuto"), icon: Monitor },
    ] as const;

    return (
        <div className="relative" ref={menuRef}>
            {/* Solo el avatar como disparador (móvil y escritorio) */}
            <button
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                aria-label={t("openProfile")}
                className="w-9 h-9 rounded-full bg-[var(--color-primary)] flex items-center justify-center text-white font-bold shadow-sm hover:brightness-110 transition-all focus:outline-none focus:ring-2 focus:ring-brand-deep/50 overflow-hidden"
            >
                {photoUrl ? (
                    <img src={photoUrl} alt={shownName} className="w-full h-full object-cover" />
                ) : (
                    initial
                )}
            </button>

            {open && (
                <div className="absolute right-0 top-11 w-80 max-w-[calc(100vw-1.5rem)] bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
                    {/* Identidad */}
                    <div className="p-4 border-b border-gray-100 dark:border-slate-800">
                        <div className="flex items-center gap-3">
                            <div className="w-11 h-11 rounded-full bg-[var(--color-primary)] flex items-center justify-center text-white font-bold text-lg shrink-0 overflow-hidden">
                                {photoUrl ? (
                                    <img src={photoUrl} alt={shownName} className="w-full h-full object-cover" />
                                ) : (
                                    initial
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                {editing ? (
                                    <div className="flex items-center gap-1">
                                        <input
                                            value={nameDraft}
                                            onChange={(e) => setNameDraft(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === "Enter") saveName(); }}
                                            maxLength={255}
                                            autoFocus
                                            className="flex-1 min-w-0 border border-gray-300 dark:border-slate-600 rounded-md px-2 py-1 text-sm bg-transparent text-gray-900 dark:text-white outline-none focus:border-brand-deep"
                                        />
                                        <button onClick={saveName} disabled={saving || nameDraft.trim().length < 2} aria-label={t("save")} className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded disabled:opacity-40">
                                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                        </button>
                                        <button onClick={() => setEditing(false)} disabled={saving} aria-label={t("cancel")} className="p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded">
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-1.5">
                                        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{shownName}</p>
                                        <button
                                            onClick={() => { setNameDraft(shownName); setEditing(true); }}
                                            aria-label={t("editName")}
                                            title={t("editName")}
                                            className="p-1 text-gray-400 hover:text-brand-deep shrink-0"
                                        >
                                            <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                )}
                                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{account.username}</p>
                                <span className="inline-block mt-1 text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-brand-soft text-brand-deep dark:bg-slate-800 dark:text-brand-sky">
                                    {role || userRole}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Moneda */}
                    <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800">
                        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{t("currency")}</label>
                        <CurrencySelector className="w-full border border-gray-200 dark:border-slate-700 rounded-md px-2 py-1.5 text-sm bg-white dark:bg-slate-800 dark:text-gray-100" />
                    </div>

                    {/* Aspecto */}
                    <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800">
                        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">{t("appearance")}</label>
                        <div className="grid grid-cols-3 gap-1.5">
                            {themeOptions.map(({ value, label, icon: Icon }) => (
                                <button
                                    key={value}
                                    onClick={() => setTheme(value)}
                                    className={`flex flex-col items-center gap-1 py-2 rounded-lg border text-[11px] font-semibold transition-colors ${mounted && theme === value
                                        ? "border-brand-deep bg-brand-soft/60 text-brand-deep dark:bg-slate-800 dark:text-brand-sky"
                                        : "border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"}`}
                                >
                                    <Icon className="w-4 h-4" />
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Salir */}
                    <div className="p-2">
                        <button
                            onClick={handleLogout}
                            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                            <LogOut className="w-4 h-4" /> {t("logout")}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
