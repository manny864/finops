"use client";
import React from "react";
import { useMsal } from "@azure/msal-react";
import { useProviderTranslations } from "@/lib/useProviderTranslations";
import {
    IconAlertTriangle,
    IconCoins,
    IconMail,
    IconLogout,
    IconShieldLock,
} from "@tabler/icons-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";

interface UnregisteredUserScreenProps {
    onGoToPricing?: () => void;
}

export default function UnregisteredUserScreen({ onGoToPricing }: UnregisteredUserScreenProps) {
    const { instance, accounts } = useMsal();
    const t = useProviderTranslations("UnregisteredUser");
    const email = accounts[0]?.username || accounts[0]?.name || "Desconocido";
    const tenantId = accounts[0]?.tenantId || "";

    const handleLogout = () => {
        instance.logoutRedirect({
            postLogoutRedirectUri: typeof window !== "undefined" ? window.location.origin : "/",
        }).catch((e) => console.error("Logout error:", e));
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-[#0B1523] via-[#1B2A41] to-[#0B1523] flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 relative font-sans items-center overflow-hidden">
            {/* Top Bar Switcher */}
            <div className="absolute top-4 right-4 z-50">
                <LanguageSwitcher variant="white" />
            </div>

            {/* Glowing Ambient Backdrop */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[45%] h-[45%] rounded-full bg-amber-500/10 blur-[120px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[45%] h-[45%] rounded-full bg-blue-600/10 blur-[120px]" />
            </div>

            {/* Brand Logo Header */}
            <div className="sm:mx-auto sm:w-full sm:max-w-md text-center animate-in fade-in zoom-in duration-500 relative z-10 mb-6">
                <div className="flex items-center justify-center mb-3">
                    <img
                        src="/CSCloudSolutions.png"
                        alt="CSCloudSolutions"
                        className="w-full max-w-[340px] h-auto object-contain drop-shadow-md"
                    />
                </div>
                <p className="text-[12px] tracking-[2px] text-blue-200/70 uppercase font-semibold">
                    Cloud Management Platform
                </p>
            </div>

            {/* Main Warning Card */}
            <div className="w-full max-w-lg bg-[#1B2A41]/90 backdrop-blur-2xl border border-amber-500/30 rounded-2xl shadow-2xl p-6 sm:p-8 text-center space-y-6 relative z-10 animate-in fade-in slide-in-from-bottom-6 duration-600">
                {/* Warning Icon Badge */}
                <div className="flex justify-center">
                    <div className="w-16 h-16 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-inner">
                        <IconAlertTriangle className="w-9 h-9" />
                    </div>
                </div>

                {/* Title & Badge */}
                <div className="space-y-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        <IconShieldLock className="w-3.5 h-3.5" />
                        {t("badge")}
                    </span>
                    <h2
                        className="text-xl sm:text-2xl font-extrabold text-white tracking-tight leading-snug"
                        style={{ fontFamily: "Montserrat, sans-serif" }}
                    >
                        {t("title")}
                    </h2>
                    <p className="text-xs text-slate-300">
                        {t("subtitle")}
                    </p>
                </div>

                {/* Account Details Box */}
                <div className="p-3.5 rounded-xl bg-slate-950/50 border border-slate-700/60 text-left text-xs space-y-1.5 font-mono">
                    <div className="flex items-center justify-between text-slate-400">
                        <span className="font-sans font-medium">{t("userLabel")}</span>
                        <span className="text-amber-400 font-bold font-sans text-[11px] px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                            {t("noTenant")}
                        </span>
                    </div>
                    <div className="text-white font-semibold break-all">
                        {email}
                    </div>
                    {tenantId && (
                        <div className="text-[11px] text-slate-400 truncate">
                            Entra ID: {tenantId}
                        </div>
                    )}
                </div>

                {/* Descriptive Explanation */}
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                    {t("description", { email })}
                </p>
                <p className="text-[12px] text-slate-400 leading-relaxed border-t border-slate-800 pt-3">
                    {t("instructions")}
                </p>

                {/* Corporate Action Buttons */}
                <div className="space-y-2.5 pt-2">
                    {/* Button 1: Pricing / Purchase */}
                    <button
                        type="button"
                        onClick={onGoToPricing}
                        className="w-full py-3 px-4 rounded-xl border border-[#0054A6] text-[#0054A6] dark:text-blue-400 bg-white dark:bg-slate-800 hover:bg-blue-50 text-xs sm:text-sm font-bold transition-all shadow-md flex items-center justify-center gap-2 font-heading"
                    >
                        <IconCoins className="w-4 h-4 text-[#0054A6]" />
                        <span>{t("btnPricing")}</span>
                    </button>

                    {/* Button 2: Support Email */}
                    <a
                        href={`mailto:soporte@cscloudsolutions.com.ar?subject=Solicitud de Acceso FinOps - ${encodeURIComponent(email)}&body=Hola equipo de CSCloudSolutions,%0D%0A%0D%0ASolicito acceso para la cuenta ${encodeURIComponent(email)} con Entra ID ${encodeURIComponent(tenantId)}.`}
                        className="w-full py-2.5 px-4 rounded-xl border border-slate-600 text-slate-200 bg-slate-800/80 hover:bg-slate-800 text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-2"
                    >
                        <IconMail className="w-4 h-4 text-slate-300" />
                        <span>{t("btnSupport")}</span>
                    </a>

                    {/* Button 3: Logout */}
                    <button
                        type="button"
                        onClick={handleLogout}
                        className="w-full py-2.5 px-4 rounded-xl text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 transition-all flex items-center justify-center gap-1.5"
                    >
                        <IconLogout className="w-4 h-4" />
                        <span>{t("btnLogout")}</span>
                    </button>
                </div>
            </div>

            {/* Footer */}
            <p className="text-center text-[11px] text-slate-400 mt-6 tracking-wide relative z-10">
                &copy; {new Date().getFullYear()} CSCloudSolutions. {t("allRightsReserved")}
            </p>
        </div>
    );
}
