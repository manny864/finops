import SecurityServiceCostBoard from "@/components/dashboard/SecurityServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";

export default async function WafPage() {
    const t = await getTranslations("SecurityFamilies");
    return (
        <SecurityServiceCostBoard
            family="waf"
            title={t("wafTitle")}
            subtitle={t("wafSubtitle")}
            icon={<ShieldAlert className="w-7 h-7 text-[#0054A6]" />}
        />
    );
}
