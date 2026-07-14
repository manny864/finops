import React from 'react';
import { getTranslations } from 'next-intl/server';
import MockBanner from '@/components/MockBanner';
import UnitEconomics from '@/components/dashboard/UnitEconomics';

export default async function UnitEconomicsPage() {
    const t = await getTranslations("UnitEconomics");

    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">📊</span>
                        {t("title")}
                    </div>
                    <div className="vs">{t("subtitle")}</div>
                </div>
            </div>

            <div className="mt-6">
                <UnitEconomics />
            </div>
        </div>
    );
}
