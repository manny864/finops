import { getTranslations } from "next-intl/server";
import CapturedSavingsBoard from "@/components/dashboard/CapturedSavingsBoard";
import MockBanner from "@/components/MockBanner";
import { IconPigMoney } from "@tabler/icons-react";

export default async function CapturedSavingsPage() {
    const t = await getTranslations("OverviewCapturedSavings");

    return (
        <div className="content animate-in fade-in duration-500">
            <div className="vhead">
                <div className="title">
                    <div className="vt">
                        <span className="vico !bg-transparent !shadow-none text-[#0078D4]">
                            <IconPigMoney className="w-5 h-5 text-[#0078D4]" stroke={1.5} />
                        </span>
                        <h1 className="font-heading">{t("title")}</h1>
                    </div>
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
