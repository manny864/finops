import React from "react";
import { getTranslations } from "next-intl/server";
import MockBanner from '@/components/MockBanner';
import CostProjectionCard from "@/components/dashboard/CostProjectionCard";

export default async function CostProjectionPage() {
    const t = await getTranslations("Dashboard");

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">📈</span>
                        {t("cost_projection_title")}
                    </div>
                    <div className="vs">{t("cost_projection_page_subtitle")}</div>
                </div>
            </div>

            <div className="mt-6" style={{ minHeight: 480 }}>
                <CostProjectionCard showFullPageLink={false} />
            </div>
        </div>
    );
}
