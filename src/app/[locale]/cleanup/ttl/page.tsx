import React from "react";
import { getTranslations } from "next-intl/server";
import MockBanner from "@/components/MockBanner";
import TtlEnforcementPanel from "@/components/cleanup/TtlEnforcementPanel";
import PageHeaderTierBadge from "@/components/dashboard/PageHeaderTierBadge";
import { IconClockHour4 } from "@tabler/icons-react";
import InfoTooltip from "@/components/InfoTooltip";

export default async function TtlCleanupPage() {
  const t = await getTranslations("TTL");

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-in fade-in">
      <MockBanner />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[#0054A6] dark:text-[#00AEEF]">
              <IconClockHour4 className="w-6 h-6" stroke={1.5} />
            </span>
            <h1 className="text-xl sm:text-2xl font-bold text-[#1B2A41] dark:text-white font-['Montserrat'] tracking-tight">
              {t("pageTitle") || "Time-To-Live (TTL) Enforcement"}
            </h1>
            <InfoTooltip content="Gobernanza de recursos efímeros y sandboxes: define políticas de ciclo de vida máximo, detecta recursos por vencer o vencidos mediante tags ExpireOn y desaprovisiona con registro de auditoría." />
          </div>
          <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            <span>{t("pageSubtitle") || "Automatización y desaprovisionamiento de entornos de desarrollo y pruebas."}</span>
            <PageHeaderTierBadge tier="Business" />
          </div>
        </div>
      </div>

      <div className="w-full">
        <TtlEnforcementPanel />
      </div>
    </div>
  );
}
