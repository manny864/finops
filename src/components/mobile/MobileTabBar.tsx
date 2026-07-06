"use client";
/**
 * Barra de pestañas inferior (solo móvil, <768px): navegación estilo app
 * nativa entre las 5 pantallas core. Las páginas de análisis profundo siguen
 * accesibles vía el menú hamburguesa.
 */
import React from "react";
import { Link, usePathname } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { LayoutDashboard, BellRing, CheckCircle, LifeBuoy, User } from "lucide-react";

const TABS = [
    { href: "/mobile", icon: LayoutDashboard, key: "tabSummary", exact: true },
    { href: "/mobile/alerts", icon: BellRing, key: "tabAlerts", exact: false },
    { href: "/mobile/approvals", icon: CheckCircle, key: "tabApprovals", exact: false },
    { href: "/support", icon: LifeBuoy, key: "tabSupport", exact: false },
    { href: "/mobile/profile", icon: User, key: "tabProfile", exact: false },
] as const;

export default function MobileTabBar() {
    const t = useTranslations("Mobile");
    const pathname = usePathname();

    return (
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-gray-200 dark:border-slate-800 pb-[env(safe-area-inset-bottom)]">
            <div className="grid grid-cols-5">
                {TABS.map(({ href, icon: Icon, key, exact }) => {
                    const active = exact ? pathname === href : pathname.startsWith(href);
                    return (
                        <Link
                            key={href}
                            href={href}
                            className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold transition-colors ${active
                                ? "text-brand-deep dark:text-brand-sky"
                                : "text-gray-400 dark:text-gray-500 hover:text-gray-600"}`}
                        >
                            <Icon className={`w-6 h-6 ${active ? "" : "opacity-80"}`} strokeWidth={active ? 2.4 : 2} />
                            {t(key)}
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
