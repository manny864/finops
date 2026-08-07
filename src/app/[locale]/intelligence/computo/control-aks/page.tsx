import React from "react";
import { getTranslations } from "next-intl/server";
import MockBanner from "@/components/MockBanner";
import AksIntelligence from "@/components/dashboard/AksIntelligence";
import AksChargebackPage from "../../aks-chargeback/page";
import { Settings } from "lucide-react";

export default async function ControlAksPage() {
    const t = await getTranslations("ComputeHub");

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico">
                            <Settings className="w-5 h-5" />
                        </span>
                        {t("tabAksControl")}
                    </div>
                    <div className="vs">{t("aksSubtitle")}</div>
                </div>
            </div>

            <div className="mt-6">
                <AksIntelligence />
            </div>

            <div className="mt-8">
                <AksChargebackPage />
            </div>
        </div>
    );
}
