import React from "react";
import { getTranslations } from "next-intl/server";
import MockBanner from '@/components/MockBanner';
import NetworkingZombiesPanel from "@/components/dashboard/NetworkingZombiesPanel";
import { Network } from "lucide-react";

export default async function NetworkingZombiesPage() {
    const t = await getTranslations("NetworkingZombies");

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#7C3AED] to-[#C4B5FD]">🌐</span>
                        {t("pageTitle")}
                    </div>
                    <div className="vs">
                        {t("pageSubtitle")}{" "}
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400 ml-1">
                            <Network className="w-3 h-3" />
                            Essential
                        </span>
                    </div>
                </div>
            </div>

            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-6">
                <NetworkingZombiesPanel />
            </div>
        </div>
    );
}
