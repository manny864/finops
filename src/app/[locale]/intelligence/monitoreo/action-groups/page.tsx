import MonitoringServiceCostBoard from "@/components/dashboard/MonitoringServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { BellRing } from "lucide-react";

export default async function ActionGroupsPage() {
    const t = await getTranslations("MonitoringFamilies");
    return (
        <MonitoringServiceCostBoard
            family="action-groups"
            title={t("actionGroupsTitle")}
            subtitle={t("actionGroupsSubtitle")}
            icon={<BellRing className="w-7 h-7 text-[#0054A6]" />}
        />
    );
}
