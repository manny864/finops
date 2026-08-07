import React from "react";
import { getTranslations } from "next-intl/server";
import MockBanner from "@/components/MockBanner";
import { AzureSqlBoard } from "@/components/dashboard/AzureSqlBoard";

export default async function AzureSqlManagedInstancePage() {
    const t = await getTranslations("DatabasesHub");

    return (
        <div className="content animate-in fade-in px-6 py-8">
            <MockBanner />
            <div className="mb-6">
                <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                    {t("sqlTitle")}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    {t("sqlSubtitle")}
                </p>
            </div>
            <AzureSqlBoard />
        </div>
    );
}
