import NetworkServiceCostBoard from "@/components/dashboard/NetworkServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { Shuffle } from "lucide-react";

export default async function BalanceoPublicacionPage() {
    const t = await getTranslations("NetworkFamilies");
    return (
        <NetworkServiceCostBoard
            family="balancing"
            title={t("balancingTitle")}
            subtitle={t("balancingSubtitle")}
            icon={<Shuffle className="w-7 h-7 text-[#0054A6]" />}
            apiPath="/api/intelligence/network/service-cost-v2"
        />
    );
}
