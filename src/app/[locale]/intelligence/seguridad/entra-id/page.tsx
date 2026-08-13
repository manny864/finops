import EntraIdLicensingBoard from "@/components/dashboard/EntraIdLicensingBoard";
import SecurityServiceCostBoard from "@/components/dashboard/SecurityServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { IdCard } from "lucide-react";

export default async function EntraIdPage() {
    const t = await getTranslations("SecurityFamilies");
    
    return (
        <div className="space-y-0">
            {/* Licensing Overview */}
            <EntraIdLicensingBoard />
            
            {/* Services & Costs */}
            <div className="border-t border-gray-200 dark:border-slate-800">
                <SecurityServiceCostBoard
                    family="entra-id"
                    title={t("entraIdTitle")}
                    subtitle={t("entraIdSubtitle")}
                    icon={<IdCard className="w-7 h-7 text-[#0054A6]" />}
                />
            </div>
        </div>
    );
}
