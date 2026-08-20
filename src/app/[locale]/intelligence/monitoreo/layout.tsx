import { ReactNode } from "react";
import { Inter } from "next/font/google";
import { getTranslations } from "next-intl/server";
import {
    IconActivity,
    IconEye,
    IconDatabase,
    IconBell,
    IconBellRinging,
    IconBook,
    IconRadar,
    IconShield,
} from "@tabler/icons-react";
import RouteTabsNav from "@/components/navigation/RouteTabsNav";
import InfoTooltip from "@/components/InfoTooltip";

const inter = Inter({ subsets: ["latin"] });

export default async function MonitoreoLayout({ children }: { children: ReactNode }) {
    const t = await getTranslations("MonitoringHub");

    const tabs = [
        { href: "/intelligence/monitoreo", label: t("tabAppInsights"), icon: <IconEye className="w-4 h-4 text-[#0054A6]" stroke={1.5} />, tooltip: t("tooltip_tab_app_insights") },
        { href: "/intelligence/monitoreo/log-analytics-workspace", label: t("tabLogAnalyticsWorkspace"), icon: <IconDatabase className="w-4 h-4 text-[#0054A6]" stroke={1.5} />, tooltip: t("tooltip_tab_log_analytics") },
        { href: "/intelligence/monitoreo/azure-monitor", label: t("tabAzureMonitor"), icon: <IconActivity className="w-4 h-4 text-[#0054A6]" stroke={1.5} />, tooltip: t("tooltip_tab_azure_monitor") },
        { href: "/intelligence/monitoreo/microsoft-sentinel", label: t("tabSentinel"), icon: <IconShield className="w-4 h-4 text-[#0054A6]" stroke={1.5} />, tooltip: t("tooltip_tab_sentinel") },
        { href: "/intelligence/monitoreo/alerts", label: t("tabAlerts"), icon: <IconBell className="w-4 h-4 text-[#0054A6]" stroke={1.5} />, tooltip: t("tooltip_tab_alerts") },
        { href: "/intelligence/monitoreo/action-groups", label: t("tabActionGroups"), icon: <IconBellRinging className="w-4 h-4 text-[#0054A6]" stroke={1.5} />, tooltip: t("tooltip_tab_action_groups") },
        { href: "/intelligence/monitoreo/workbooks", label: t("tabWorkbooks"), icon: <IconBook className="w-4 h-4 text-[#0054A6]" stroke={1.5} />, tooltip: t("tooltip_tab_workbooks") },
        { href: "/intelligence/monitoreo/network-watcher", label: t("tabNetworkWatcher"), icon: <IconRadar className="w-4 h-4 text-[#0054A6]" stroke={1.5} />, tooltip: t("tooltip_tab_network_watcher") },
    ];

    return (
        <div className={inter.className}>
            <div className="px-6 pt-4">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <IconActivity className="w-6 h-6 text-[#0054A6]" stroke={1.5} />
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
