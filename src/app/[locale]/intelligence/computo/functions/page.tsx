import ComputeWorkloadBoard from "@/components/dashboard/ComputeWorkloadBoard";
import { getTranslations } from "next-intl/server";
import { Activity } from "lucide-react";

export default async function FunctionsPage() {
    const t = await getTranslations("ComputeHub");
    return (
        <ComputeWorkloadBoard
            family="functions"
            title={t("functionsTitle")}
            subtitle={t("functionsSubtitle")}
            icon={<Activity className="w-7 h-7 text-[#0054A6]" />}
            emptyTitle={t("emptyFunctionsTitle")}
            emptyMessage={t("emptyFunctionsSubtitle")}
        />
    );
}
