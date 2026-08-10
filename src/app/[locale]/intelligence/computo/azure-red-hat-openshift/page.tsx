import ComputeWorkloadBoard from "@/components/dashboard/ComputeWorkloadBoard";
import { getTranslations } from "next-intl/server";
import { Server } from "lucide-react";

export default async function AroPage() {
    const t = await getTranslations("ComputeHub");
    return (
        <ComputeWorkloadBoard
            family="aro"
            title={t("aroTitle")}
            subtitle={t("aroSubtitle")}
            icon={<Server className="w-7 h-7 text-[#0054A6]" />}
            emptyTitle={t("emptyAroTitle")}
            emptyMessage={t("emptyAroSubtitle")}
        />
    );
}
