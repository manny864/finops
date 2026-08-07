import React from "react";
import { getTranslations } from "next-intl/server";
import MockBanner from '@/components/MockBanner';
import CostHistogramCard from "@/components/dashboard/CostHistogramCard";
import CostProjectionCard from "@/components/dashboard/CostProjectionCard";
import { IconChartLine } from "@tabler/icons-react";

export default async function CostProjectionPage() {
    const t = await getTranslations("Dashboard");

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico">
                            <IconChartLine className="w-5 h-5" />
                        </span>
                        {t("cost_projection_page_title")}
                    </div>
                    <div className="vs">{t("cost_projection_page_subtitle")}</div>
                </div>
            </div>

            <div className="mt-6">
                <CostHistogramCard />
            </div>
            <div className="mt-4" style={{ minHeight: 480 }}>
                <CostProjectionCard showFullPageLink={false} />
            </div>
        </div>
    );
}
