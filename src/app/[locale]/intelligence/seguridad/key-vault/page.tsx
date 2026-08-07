import SecurityServiceCostBoard from "@/components/dashboard/SecurityServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { KeyRound } from "lucide-react";

export default async function KeyVaultPage() {
    const t = await getTranslations("SecurityFamilies");
    return (
        <SecurityServiceCostBoard
            family="key-vault"
            title={t("keyVaultTitle")}
            subtitle={t("keyVaultSubtitle")}
            icon={<KeyRound className="w-7 h-7 text-[#0054A6]" />}
        />
    );
}
