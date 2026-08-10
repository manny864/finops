import NetworkServiceCostBoard from "@/components/dashboard/NetworkServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { Globe } from "lucide-react";

export default async function AccesoInternetPage() {
    const t = await getTranslations("NetworkFamilies");
    return (
        <NetworkServiceCostBoard
            family="internet"
            title={t("internetTitle")}
            subtitle={t("internetSubtitle")}
            icon={<Globe className="w-7 h-7 text-[#0054A6]" />}
            apiPath="/api/intelligence/network/service-cost-v2"
        />
    );
}
