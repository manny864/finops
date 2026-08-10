import MonitoringServiceCostBoard from "@/components/dashboard/MonitoringServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { Bell } from "lucide-react";

export default async function AlertsMonitoringPage() {
    const t = await getTranslations("MonitoringFamilies");
    return (
        <MonitoringServiceCostBoard
            family="alerts"
            title={t("alertsMonitoringTitle")}
            subtitle={t("alertsMonitoringSubtitle")}
            icon={<Bell className="w-7 h-7 text-[#0054A6]" />}
        />
    );
}
