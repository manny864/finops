import React from "react";
import { getTranslations } from "next-intl/server";
import MockBanner from "@/components/MockBanner";
import Commitments from "@/components/dashboard/Commitments";
import HistoryButton from "@/components/history/HistoryButton";

export default async function ReservasInstanciasRisPage() {
    const t = await getTranslations("Commitments");
    return (
        <div className="content animate-in fade-in">
            <MockBanner />

            {/* El historial vivía sólo en `/intelligence/commitments`, que no
                está en el sidebar: quien entraba por acá —o sea, todo el mundo—
                no tenía manera de ver la evolución. El título y el subtítulo no
                se repiten porque ya los pone el layout del hub. */}
            <div className="flex justify-end mt-2">
                <HistoryButton domain="commitments" title={t('pageTitle')} />
            </div>

            <div className="mt-6">
                <Commitments />
            </div>
        </div>
    );
}
