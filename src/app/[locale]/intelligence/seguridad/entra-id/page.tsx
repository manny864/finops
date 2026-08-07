import SecurityServiceCostBoard from "@/components/dashboard/SecurityServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { IdCard } from "lucide-react";

export default async function EntraIdPage() {
    const t = await getTranslations("SecurityFamilies");
    return (
        <SecurityServiceCostBoard
            family="entra-id"
            title={t("entraIdTitle")}
            subtitle={t("entraIdSubtitle")}
            icon={<IdCard className="w-7 h-7 text-[#0054A6]" />}
        />
    );
}
