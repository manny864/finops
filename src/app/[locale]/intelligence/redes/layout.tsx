import { ReactNode } from "react";
import { Inter } from "next/font/google";
import { getTranslations } from "next-intl/server";
import RouteTabsNav from "@/components/navigation/RouteTabsNav";
import { IconTopologyStar3 } from "@tabler/icons-react";
import { Network, GitMerge, Shuffle, Globe } from "lucide-react";
import InfoTooltip from "@/components/InfoTooltip";

const inter = Inter({ subsets: ["latin"] });

export default async function RedesLayout({ children }: { children: ReactNode }) {
    const t = await getTranslations("NetworkHub");

    const tabs = [
        { href: "/intelligence/redes/network", label: t("tabAnalysisFinops"), icon: <Network className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_analysis") },
        { href: "/intelligence/redes/netwokbasic", label: t("tabBasicFinops"), icon: <Network className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_basic") },
        { href: "/intelligence/redes/hibridcon", label: t("tabHybridFinops"), icon: <GitMerge className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_hybrid") },
        { href: "/intelligence/redes/loadbalancer", label: t("tabBalancingFinops"), icon: <Shuffle className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_balancing") },
        { href: "/intelligence/redes/internet", label: t("tabInternetFinops"), icon: <Globe className="w-4 h-4 text-[#0054A6]" />, tooltip: t("tooltip_tab_internet") },
    ];

    return (
        <div className={inter.className}>
            <div className="px-6 pt-4">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <IconTopologyStar3 className="w-6 h-6 text-[#0054A6]" />
                    <span>{t("title")}</span>
                    <InfoTooltip content={t("tooltip_title")} position="bottom" align="left" />
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("subtitle")}</p>
            </div>
            <RouteTabsNav tabs={tabs} className="px-6 mt-4 mb-4" />
            {children}
        </div>
    );
}
