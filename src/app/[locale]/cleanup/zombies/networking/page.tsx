import React from "react";
import { getTranslations } from "next-intl/server";
import MockBanner from "@/components/MockBanner";
import NetworkingZombiesPanel from "@/components/cleanup/NetworkingZombiesPanel";
import PageHeaderTierBadge from "@/components/dashboard/PageHeaderTierBadge";
import { IconTopologyStar3 } from "@tabler/icons-react";
import InfoTooltip from "@/components/InfoTooltip";

export default async function NetworkingZombiesPage() {
  const t = await getTranslations("NetworkingZombies");

  return (
    <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6 animate-in fade-in">
      <MockBanner />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[#0054A6] dark:text-[#00AEEF]">
              <IconTopologyStar3 className="w-6 h-6" stroke={1.5} />
            </span>
            <h1 className="text-xl sm:text-2xl font-bold text-[#1B2A41] dark:text-white font-['Montserrat'] tracking-tight">
              {t("pageTitle")}
            </h1>
            <InfoTooltip content="Auditoría integral de recursos de red zombis: VPN / ExpressRoute Gateways ociosos, IPs públicas huérfanas, Private Endpoints desconectados, NAT Gateways vacíos y firewalls sin reglas." />
          </div>
          <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            <span>{t("pageSubtitle")}</span>
            <PageHeaderTierBadge tier="Professional" />
          </div>
        </div>
      </div>

      <div className="w-full">
        <NetworkingZombiesPanel />
      </div>
    </div>
  );
}
