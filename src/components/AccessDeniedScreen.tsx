"use client";
import React from "react";
import { useMsal } from "@azure/msal-react";
import { useProviderTranslations } from "@/lib/useProviderTranslations";
import { IconLock, IconMail, IconLogout, IconRefresh, IconShieldLock } from "@tabler/icons-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import type { AccesoDenegado } from "@/types/accesoTenant.types";

interface AccessDeniedScreenProps {
    acceso: AccesoDenegado;
    /** Vuelve a consultar el acceso (p. ej. después de que un administrador libera un lugar). */
    onRetry?: () => void;
}

/**
 * STRIDE-03 — la persona se autenticó con Microsoft pero la organización no la admite. Explica POR QUÉ (cupo del plan,
 * cuenta deshabilitada, invitación pendiente…) y qué hacer. A diferencia de `UnregisteredUserScreen`, no ofrece comprar un
 * plan: acá la organización ya existe y la decisión es de su administrador.
 */
export default function AccessDeniedScreen({ acceso, onRetry }: AccessDeniedScreenProps) {
    const { instance, accounts } = useMsal();
    const t = useProviderTranslations("AccessDenied");
    const email = accounts[0]?.username || accounts[0]?.name || "";

    const handleLogout = () => {
        instance.logoutRedirect({
            postLogoutRedirectUri: typeof window !== "undefined" ? window.location.origin : "/",
        }).catch((e) => console.error("Logout error:", e));
    };

    // Las claves son literales a propósito: i18nKeyIntegrity sólo valida las que puede leer estáticamente.
    let title: string;
    let body: string;
    switch (acceso.motivo) {
        case "SIN_CUPO":
            title = t("sinCupoTitle");
            body = t("sinCupoBody", { tier: acceso.tier ?? "", limite: acceso.limite ?? 0 });
            break;
        case "DESHABILITADA":
            title = t("deshabilitadaTitle");
            body = t("deshabilitadaBody", { email });
            break;
        case "NO_INVITADO":
            title = t("noInvitadoTitle");
            body = t("noInvitadoBody", { email });
            break;
        default:
            // SIN_ACCESO y SIN_SUSCRIPCION (esta última normalmente la atiende UnregisteredUserScreen).
            title = t("sinAccesoTitle");
            body = t("sinAccesoBody", { email });
    }

    const subject = encodeURIComponent(`Acceso FinOps (${acceso.motivo}) - ${email}`);

    return (
        <div
            data-testid="access-denied-screen"
            className="min-h-screen bg-gradient-to-br from-[#0B1523] via-[#1B2A41] to-[#0B1523] flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 relative"
        >
            <div className="absolute top-4 right-4 z-50">
                <LanguageSwitcher variant="white" />
            </div>

            <div className="sm:mx-auto sm:w-full sm:max-w-md text-center relative z-10 mb-6">
                {/* eslint-disable-next-line @next/next/no-img-element -- asset estático local, igual que UnregisteredUserScreen */}
                <img src="/CSCloudSolutions.png" alt="CSCloudSolutions" className="w-full max-w-[340px] h-auto object-contain mx-auto drop-shadow-md" />
            </div>

            <section
                role="alert"
                aria-labelledby="access-denied-title"
                className="w-full max-w-lg mx-auto bg-[#1B2A41]/90 backdrop-blur-2xl border border-amber-500/30 rounded-2xl shadow-2xl p-6 sm:p-8 text-center space-y-6 relative z-10"
            >
                <div className="flex justify-center">
                    <div className="w-16 h-16 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-inner">
                        <IconLock className="w-9 h-9" aria-hidden="true" />
                    </div>
                </div>

                <div className="space-y-2">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        <IconShieldLock className="w-3.5 h-3.5" aria-hidden="true" />
                        {t("badge")}
                    </span>
                    <h2 id="access-denied-title" className="text-xl sm:text-2xl font-extrabold text-white tracking-tight leading-snug">
                        {title}
                    </h2>
                </div>

                {email && (
                    <div className="p-3.5 rounded-xl bg-slate-950/50 border border-slate-700/60 text-left text-xs space-y-1.5 font-mono">
                        <div className="text-slate-400 font-sans font-medium">{t("userLabel")}</div>
                        <div className="text-white font-semibold break-all">{email}</div>
                    </div>
                )}

                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">{body}</p>

                <div className="space-y-2.5 pt-2">
                    {onRetry && (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="w-full py-3 px-4 rounded-xl border border-[#0054A6] text-[#0054A6] bg-white hover:bg-blue-50 text-sm font-semibold transition-all flex items-center justify-center gap-2"
                        >
                            <IconRefresh className="w-4 h-4" aria-hidden="true" />
                            <span>{t("btnRetry")}</span>
                        </button>
                    )}
                    <a
                        href={`mailto:soporte@cscloudsolutions.com.ar?subject=${subject}`}
                        className="w-full py-2.5 px-4 rounded-xl border border-slate-600 text-slate-200 bg-slate-800/80 hover:bg-slate-800 text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-2"
                    >
                        <IconMail className="w-4 h-4 text-slate-300" aria-hidden="true" />
                        <span>{t("btnSupport")}</span>
                    </a>
                    <button
                        type="button"
                        onClick={handleLogout}
                        className="w-full py-2.5 px-4 rounded-xl text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 transition-all flex items-center justify-center gap-2"
                    >
                        <IconLogout className="w-4 h-4" aria-hidden="true" />
                        <span>{t("btnLogout")}</span>
                    </button>
                </div>
            </section>

            <p className="text-center text-[11px] text-slate-400 mt-6 tracking-wide relative z-10">
                &copy; {new Date().getFullYear()} CSCloudSolutions. {t("allRightsReserved")}
            </p>
        </div>
    );
}
