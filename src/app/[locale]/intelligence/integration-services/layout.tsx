import { ReactNode } from "react";
import { Inter } from "next/font/google";
import { getTranslations } from "next-intl/server";
import {
  IconTopologyStarRing3,
  IconApiApp,
  IconMessageDots,
  IconBroadcast,
  IconAntenna,
  IconBuildingFactory2,
} from "@tabler/icons-react";
import RouteTabsNav from "@/components/navigation/RouteTabsNav";
import InfoTooltip from "@/components/InfoTooltip";

const inter = Inter({ subsets: ["latin"] });

export default async function IntegrationServicesLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("IntegrationServicesHub");

  const tabs = [
    {
      href: "/intelligence/integration-services/logic-apps",
      label: t("tabLogicApps"),
      icon: <IconTopologyStarRing3 className="w-4 h-4 text-[#0054A6]" stroke={1.5} />,
      tooltip: t("tooltip_tab_logic_apps"),
    },
    {
      href: "/intelligence/integration-services/apim",
      label: t("tabApim"),
      icon: <IconApiApp className="w-4 h-4 text-[#0054A6]" stroke={1.5} />,
      tooltip: t("tooltip_tab_apim"),
    },
    {
      href: "/intelligence/integration-services/service-bus",
      label: t("tabServiceBus"),
      icon: <IconMessageDots className="w-4 h-4 text-[#0054A6]" stroke={1.5} />,
      tooltip: t("tooltip_tab_service_bus"),
    },
    {
      href: "/intelligence/integration-services/event-grid",
      label: t("tabEventGrid"),
      icon: <IconBroadcast className="w-4 h-4 text-[#0054A6]" stroke={1.5} />,
      tooltip: t("tooltip_tab_event_grid"),
    },
    {
      href: "/intelligence/integration-services/event-hubs",
      label: t("tabEventHubs"),
      icon: <IconAntenna className="w-4 h-4 text-[#0054A6]" stroke={1.5} />,
      tooltip: t("tooltip_tab_event_hubs"),
    },
    {
      href: "/intelligence/integration-services/adf",
      label: t("tabAdf"),
      icon: <IconBuildingFactory2 className="w-4 h-4 text-[#0054A6]" stroke={1.5} />,
      tooltip: t("tooltip_tab_adf"),
    },
  ];

  return (
    <div className={`w-full max-w-full ${inter.className}`}>
      <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 pt-4">
        <h1 className="text-2xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
          <IconTopologyStarRing3 className="w-6 h-6 text-[#0054A6]" stroke={1.5} />
          <span>{t("title")}</span>
          <InfoTooltip content={t("tooltip_title")} position="bottom" align="left" />
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("subtitle")}</p>
      </div>
      <RouteTabsNav tabs={tabs} className="w-full max-w-full px-4 sm:px-6 lg:px-8 mt-4 mb-4" />
      <div className="w-full max-w-full">
        {children}
      </div>
    </div>
  );
}
