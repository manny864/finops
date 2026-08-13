import { ReactNode } from "react";
import { Inter } from "next/font/google";
import { getTranslations } from "next-intl/server";
import { ShieldCheck, Shield, KeyRound, IdCard, ShieldAlert, ShieldBan, BarChart3 } from "lucide-react";
import RouteTabsNav from "@/components/navigation/RouteTabsNav";

const inter = Inter({ subsets: ["latin"] });

export default async function SeguridadLayout({ children }: { children: ReactNode }) {
    const t = await getTranslations("SecurityHub");

    const tabs = [
        { href: "/intelligence/seguridad", label: t("tabDefender"), icon: <Shield className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/seguridad/defender-detalles", label: "Defender Detalles", icon: <BarChart3 className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/seguridad/microsoft-sentinel", label: t("tabSentinel"), icon: <ShieldCheck className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/seguridad/key-vault", label: t("tabKeyVault"), icon: <KeyRound className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/seguridad/entra-id", label: t("tabEntraId"), icon: <IdCard className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/seguridad/waf", label: t("tabWaf"), icon: <ShieldAlert className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/seguridad/ddos-protection", label: t("tabDdos"), icon: <ShieldBan className="w-4 h-4 text-[#0054A6]" /> },
    ];

    return (
        <div className={inter.className}>
            <div className="px-6 pt-4">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <ShieldCheck className="w-6 h-6 text-[#0054A6]" />
                    {t("title")}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("subtitle")}</p>
            </div>
            <RouteTabsNav tabs={tabs} className="px-6 mt-4 mb-4" />
            {children}
        </div>
    );
}
