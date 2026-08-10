import NetworkServiceCostBoard from "@/components/dashboard/NetworkServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { GitMerge } from "lucide-react";

export default async function ConectividadHibridaPage() {
    const t = await getTranslations("NetworkFamilies");
    return (
        <NetworkServiceCostBoard
            family="hybrid"
            title={t("hybridTitle")}
            subtitle={t("hybridSubtitle")}
            icon={<GitMerge className="w-7 h-7 text-[#0054A6]" />}
            apiPath="/api/intelligence/network/service-cost-v2"
        />
    );
}
