import { ReactNode } from "react";
import { Inter } from "next/font/google";
import { getTranslations } from "next-intl/server";
import { Activity, Eye, Database, Bell, BellRing, BookOpen, Radar, Shield } from "lucide-react";
import RouteTabsNav from "@/components/navigation/RouteTabsNav";
import RouteTabsFilter from "@/components/navigation/RouteTabsFilter";

const inter = Inter({ subsets: ["latin"] });

export default async function MonitoreoLayout({ children }: { children: ReactNode }) {
    const t = await getTranslations("MonitoringHub");

    const tabs = [
        { href: "/intelligence/monitoreo", label: t("tabAppInsights"), icon: <Eye className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/monitoreo/log-analytics-workspace", label: t("tabLogAnalyticsWorkspace"), icon: <Database className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/monitoreo/azure-monitor", label: t("tabAzureMonitor"), icon: <Activity className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/monitoreo/microsoft-sentinel", label: t("tabSentinel"), icon: <Shield className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/monitoreo/alerts", label: t("tabAlerts"), icon: <Bell className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/monitoreo/action-groups", label: t("tabActionGroups"), icon: <BellRing className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/monitoreo/workbooks", label: t("tabWorkbooks"), icon: <BookOpen className="w-4 h-4 text-[#0054A6]" /> },
        { href: "/intelligence/monitoreo/network-watcher", label: t("tabNetworkWatcher"), icon: <Radar className="w-4 h-4 text-[#0054A6]" /> },
    ];

    return (
        <div className={inter.className}>
            <div className="px-6 pt-4">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Activity className="w-6 h-6 text-[#0054A6]" />
                    {t("title")}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("subtitle")}</p>
            </div>
            <RouteTabsNav tabs={tabs} className="px-6 mt-4 mb-4" />
            <RouteTabsFilter />
            {children}
        </div>
    );
}
