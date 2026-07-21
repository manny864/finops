import React from "react";
import { getTranslations } from "next-intl/server";
import MockBanner from '@/components/MockBanner';
import TenantHealthDashboard from "@/components/dashboard/TenantHealthDashboard";
import { HeartPulse } from "lucide-react";

export default async function TenantHealthPage() {
    const t = await getTranslations("IntelligenceTenantHealth");

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt flex items-center gap-2">
                        <span className="vico bg-gradient-to-br from-rose-500 to-pink-700 text-white p-2 rounded-xl">
                            <HeartPulse className="w-5 h-5" />
                        </span>
                        {t("title")}
                    </div>
                    <div className="vs">{t("subtitle")}</div>
                </div>
            </div>

            <TenantHealthDashboard />
        </div>
    );
}
