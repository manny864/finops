import MonitoringServiceCostBoard from "@/components/dashboard/MonitoringServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { Shield } from "lucide-react";

export default async function MicrosoftSentinelPage() {
    const t = await getTranslations("MonitoringFamilies");
    return (
        <MonitoringServiceCostBoard
            family="microsoft-sentinel"
            title={t("sentinelTitle")}
            subtitle={t("sentinelSubtitle")}
            icon={<Shield className="w-7 h-7 text-[#0054A6]" />}
        />
    );
}
