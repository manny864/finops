import TopExpensesBoard from "@/components/dashboard/TopExpensesBoard";
import MockBanner from "@/components/MockBanner";
import { IconChartBar } from "@tabler/icons-react";
import { getTranslations } from "next-intl/server";

export default async function TopExpensesPage() {
    const t = await getTranslations("TopExpenses");

    return (
        <div className="content animate-in fade-in duration-500">
            <div className="vhead">
                <div className="title">
                    <div className="vt">
                        <span className="vico !bg-transparent !shadow-none">
                            <IconChartBar className="w-5 h-5" />
                        </span>
                        <span className="font-heading">{t("title")}</span>
                    </div>
                    <p>{t("subtitle")}</p>
                </div>
            </div>
            <div className="mt-6">
                <MockBanner />
                <TopExpensesBoard />
            </div>
        </div>
    );
}
