import ComputeServiceCostBoard from "@/components/dashboard/ComputeServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { Activity } from "lucide-react";

export default async function FunctionsPage() {
    const t = await getTranslations("ComputeFamilies");
    return (
        <ComputeServiceCostBoard
            family="functions"
            title={t("functionsTitle")}
            subtitle={t("functionsSubtitle")}
            icon={<Activity className="w-7 h-7 text-[#0054A6]" />}
        />
    );
}
