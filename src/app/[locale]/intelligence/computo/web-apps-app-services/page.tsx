import { Globe } from "lucide-react";
import ComputeWorkloadBoard from "@/components/dashboard/ComputeWorkloadBoard";
import { getTranslations } from "next-intl/server";

export default async function WebAppsPage() {
    const t = await getTranslations("ComputeHub");
    return (
        <ComputeWorkloadBoard
            family="webapps"
            title={t("webAppServicesTitle")}
            subtitle={t("webAppServicesSubtitle")}
            icon={<Globe className="w-7 h-7 text-[#0054A6]" />}
            emptyTitle={t("emptyWebAppsTitle")}
            emptyMessage={t("emptyWebAppsSubtitle")}
        />
    );
}
