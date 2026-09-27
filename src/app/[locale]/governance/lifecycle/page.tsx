import React from "react";
import { getTranslations } from "next-intl/server";
import MockBanner from "@/components/MockBanner";
import LifecycleBoard from "@/components/dashboard/LifecycleBoard";
import { IconClockExclamation } from "@tabler/icons-react";

export default async function LifecyclePage() {
    const t = await getTranslations("Lifecycle");

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico">
                            <IconClockExclamation className="w-5 h-5" />
                        </span>
                        {t("pageTitle")}
                    </div>
                    <div className="vs">{t("pageSubtitle")}</div>
                </div>
            </div>

            <div className="mt-6">
                <LifecycleBoard />
            </div>
        </div>
    );
}
