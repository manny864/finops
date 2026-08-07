import { getTranslations } from "next-intl/server";
import CostCenterBudgetsBoard from "@/components/dashboard/CostCenterBudgetsBoard";
import MockBanner from "@/components/MockBanner";
import { Building2 } from "lucide-react";

export default async function CostCentersPage() {
    const t = await getTranslations("IntelligenceCostCenters");
    return (
        <div className="content animate-in fade-in duration-500">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico">
                            <Building2 className="w-5 h-5" />
                        </span>
                        {t("pageTitle")}
                    </div>
                    <div className="vs">{t("pageSubtitle")}</div>
                </div>
            </div>
            <div className="mt-6">
                <MockBanner />
                <CostCenterBudgetsBoard />
            </div>
        </div>
    );
}
