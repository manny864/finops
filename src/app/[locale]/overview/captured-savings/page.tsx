import { getTranslations } from "next-intl/server";
import CapturedSavingsBoard from "@/components/dashboard/CapturedSavingsBoard";
import MockBanner from "@/components/MockBanner";

export default async function CapturedSavingsPage() {
    const t = await getTranslations("OverviewCapturedSavings");

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
                <CapturedSavingsBoard />
            </div>
        </div>
    );
}
