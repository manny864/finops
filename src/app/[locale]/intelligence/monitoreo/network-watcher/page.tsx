import MonitoringServiceCostBoard from "@/components/dashboard/MonitoringServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { Radar } from "lucide-react";

export default async function NetworkWatcherPage() {
    const t = await getTranslations("MonitoringFamilies");
    return (
        <MonitoringServiceCostBoard
            family="network-watcher"
            title={t("networkWatcherTitle")}
            subtitle={t("networkWatcherSubtitle")}
            icon={<Radar className="w-7 h-7 text-[#0054A6]" />}
        />
    );
}
