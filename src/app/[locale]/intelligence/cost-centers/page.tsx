import { getTranslations } from "next-intl/server";
import CostCenterBudgetsBoard from "@/components/dashboard/CostCenterBudgetsBoard";
import MockBanner from "@/components/MockBanner";

export default async function CostCentersPage() {
    const t = await getTranslations("IntelligenceCostCenters");
    return (
        <div className="content animate-in fade-in duration-500">
            <div className="vhead">
                <div className="title">
                    <h1>{t("pageTitle")}</h1>
                    <p>{t("pageSubtitle")}</p>
                </div>
            </div>
            <div className="mt-6">
                <MockBanner />
                <CostCenterBudgetsBoard />
            </div>
        </div>
    );
}
