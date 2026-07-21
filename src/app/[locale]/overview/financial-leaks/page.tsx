import { getTranslations } from "next-intl/server";
import FinancialLeaksBoard from "@/components/dashboard/FinancialLeaksBoard";
import MockBanner from "@/components/MockBanner";

export default async function FinancialLeaksPage() {
    const t = await getTranslations("OverviewFinancialLeaks");

    return (
        <div className="content animate-in fade-in duration-500">
            <div className="vhead">
                <div className="title">
                    <h1>{t("title")}</h1>
                    <p>{t("subtitle")}</p>
                </div>
            </div>
            <div className="mt-6">
                <MockBanner />
                <FinancialLeaksBoard />
            </div>
        </div>
    );
}
