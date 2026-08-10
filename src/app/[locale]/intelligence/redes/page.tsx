import NetworkServiceCostBoard from "@/components/dashboard/NetworkServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { Network } from "lucide-react";

export default async function RedesPage() {
    const t = await getTranslations("NetworkFamilies");
    return (
        <NetworkServiceCostBoard
            family="analysis"
            title={t("analysisTitle")}
            subtitle={t("analysisSubtitle")}
            icon={<Network className="w-7 h-7 text-[#0054A6]" />}
            apiPath="/api/intelligence/network/service-cost-v2"
        />
    );
}
