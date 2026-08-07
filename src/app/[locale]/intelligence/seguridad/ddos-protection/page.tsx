import SecurityServiceCostBoard from "@/components/dashboard/SecurityServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { ShieldBan } from "lucide-react";

export default async function DdosProtectionPage() {
    const t = await getTranslations("SecurityFamilies");
    return (
        <SecurityServiceCostBoard
            family="ddos"
            title={t("ddosTitle")}
            subtitle={t("ddosSubtitle")}
            icon={<ShieldBan className="w-7 h-7 text-[#0054A6]" />}
        />
    );
}
