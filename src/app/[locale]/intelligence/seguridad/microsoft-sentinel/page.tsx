import SecurityServiceCostBoard from "@/components/dashboard/SecurityServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";

export default async function MicrosoftSentinelPage() {
    const t = await getTranslations("SecurityFamilies");
    return (
        <SecurityServiceCostBoard
            family="sentinel"
            title={t("sentinelTitle")}
            subtitle={t("sentinelSubtitle")}
            icon={<ShieldCheck className="w-7 h-7 text-[#0054A6]" />}
        />
    );
}
