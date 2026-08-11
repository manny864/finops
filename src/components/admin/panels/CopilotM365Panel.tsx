import React from "react";
import { getTranslations } from "next-intl/server";
import M365CopilotConfigPanel from "@/components/dashboard/M365CopilotConfigPanel";
import { IconRobot } from "@tabler/icons-react";

export default async function CopilotM365Page() {
    const t = await getTranslations("CopilotM365");

    return (
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico !bg-transparent !shadow-none"><IconRobot className="w-5 h-5" /></span>
                        {t("title")}
                    </div>
                    <div className="vs">{t("subtitle")}</div>
                </div>
            </div>

            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-6">
                <M365CopilotConfigPanel />
            </div>
        </div>
    );
}
