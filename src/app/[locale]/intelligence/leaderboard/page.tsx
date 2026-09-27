import React from "react";
import { getTranslations } from "next-intl/server";
import MockBanner from "@/components/MockBanner";
import LeaderboardBoard from "@/components/dashboard/LeaderboardBoard";
import { IconTrophy } from "@tabler/icons-react";

export default async function LeaderboardPage() {
    const t = await getTranslations("Leaderboard");

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico">
                            <IconTrophy className="w-5 h-5" />
                        </span>
                        {t("pageTitle")}
                    </div>
                    <div className="vs">{t("pageSubtitle")}</div>
                </div>
            </div>

            <div className="mt-6">
                <LeaderboardBoard />
            </div>
        </div>
    );
}
