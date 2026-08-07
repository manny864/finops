import MonitoringServiceCostBoard from "@/components/dashboard/MonitoringServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { BookOpen } from "lucide-react";

export default async function WorkbooksPage() {
    const t = await getTranslations("MonitoringFamilies");
    return (
        <MonitoringServiceCostBoard
            family="workbooks"
            title={t("workbooksTitle")}
            subtitle={t("workbooksSubtitle")}
            icon={<BookOpen className="w-7 h-7 text-[#0054A6]" />}
        />
    );
}
