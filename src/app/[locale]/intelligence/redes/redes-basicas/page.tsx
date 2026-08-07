import NetworkServiceCostBoard from "@/components/dashboard/NetworkServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { Network } from "lucide-react";

export default async function RedesBasicasPage() {
    const t = await getTranslations("NetworkFamilies");
    return (
        <NetworkServiceCostBoard
            family="basic"
            title={t("basicTitle")}
            subtitle={t("basicSubtitle")}
            icon={<Network className="w-7 h-7 text-[#0054A6]" />}
        />
    );
}
