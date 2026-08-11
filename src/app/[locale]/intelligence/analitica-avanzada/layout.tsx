import { ReactNode } from "react";
import { Inter } from "next/font/google";
import { getTranslations } from "next-intl/server";
import {
    IconChartBar,
    IconChartLine,
    IconCoins,
    IconDatabase,
    IconDatabaseCog,
    IconLayoutDashboard,
    IconPackage,
    IconTag,
    IconTopologyStar3,
} from "@tabler/icons-react";
import RouteTabsNav from "@/components/navigation/RouteTabsNav";

const inter = Inter({ subsets: ["latin"] });

export default async function AnaliticaAvanzadaLayout({ children }: { children: ReactNode }) {
    const t = await getTranslations("AdvancedAnalyticsHub");

    const tabs = [
        { href: "/intelligence/analitica-avanzada", label: t("tabUnitEconomics"), icon: <IconLayoutDashboard className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/analitica-avanzada/prorrateo-allocation", label: t("tabAllocation"), icon: <IconTopologyStar3 className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/analitica-avanzada/scorecard-fama", label: t("tabScorecard"), icon: <IconChartBar className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/analitica-avanzada/deteccion-de-anomalias", label: t("tabAnomalies"), icon: <IconTag className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/analitica-avanzada/salud-del-tenant", label: t("tabTenantHealth"), icon: <IconDatabaseCog className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/analitica-avanzada/simulador-what-if", label: t("tabSimulator"), icon: <IconPackage className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/analitica-avanzada/alertas-self-service", label: t("tabAlerts"), icon: <IconDatabase className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/analitica-avanzada/macc-tracking", label: t("tabMacc"), icon: <IconCoins className="w-4 h-4 text-[#0054A6]" /> },
    ];

    return (
        <div className={inter.className}>
            <div className="px-6 pt-4">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <IconChartLine className="w-6 h-6 text-[#0054A6]" />
                    {t("title")}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("subtitle")}</p>
            </div>
            <RouteTabsNav tabs={tabs} className="px-6 mt-4 mb-4" />
            {children}
        </div>
    );
}
