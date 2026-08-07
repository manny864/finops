import MonitoringServiceCostBoard from "@/components/dashboard/MonitoringServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { Activity } from "lucide-react";

export default async function AzureMonitorPage() {
    const t = await getTranslations("MonitoringFamilies");
    return (
        <MonitoringServiceCostBoard
            family="azure-monitor"
            title={t("azureMonitorTitle")}
            subtitle={t("azureMonitorSubtitle")}
            icon={<Activity className="w-7 h-7 text-[#0054A6]" />}
        />
    );
}
