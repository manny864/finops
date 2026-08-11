import { getTranslations } from "next-intl/server";
import FinancialLeaksBoard from "@/components/dashboard/FinancialLeaksBoard";
import MockBanner from "@/components/MockBanner";
import { IconDropletDollar } from "@tabler/icons-react";

export default async function FinancialLeaksPage() {
    const t = await getTranslations("OverviewFinancialLeaks");

    return (
        <div className="content animate-in fade-in duration-500">
            <div className="vhead">
                <div className="title">
                    <div className="vt">
                        <span className="vico">
                            <IconDropletDollar className="w-5 h-5" />
                        </span>
                        <h1 className="font-heading">{t("title")}</h1>
                    </div>
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
