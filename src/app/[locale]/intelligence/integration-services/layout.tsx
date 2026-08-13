import { ReactNode } from "react";
import { Inter } from "next/font/google";
import { getTranslations } from "next-intl/server";
import { Workflow, GitBranch, MessageSquare, Send, RadioTower, Factory } from "lucide-react";
import RouteTabsNav from "@/components/navigation/RouteTabsNav";

const inter = Inter({ subsets: ["latin"] });

export default async function IntegrationServicesLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("IntegrationServicesHub");

  const tabs = [
    { href: "/intelligence/integration-services/logic-apps", label: t("tabLogicApps"), icon: <Workflow className="w-4 h-4 text-[#0054A6]" /> },
    { href: "/intelligence/integration-services/apim", label: t("tabApim"), icon: <GitBranch className="w-4 h-4 text-[#0054A6]" /> },
    { href: "/intelligence/integration-services/service-bus", label: t("tabServiceBus"), icon: <MessageSquare className="w-4 h-4 text-[#0054A6]" /> },
    { href: "/intelligence/integration-services/event-grid", label: t("tabEventGrid"), icon: <Send className="w-4 h-4 text-[#0054A6]" /> },
    { href: "/intelligence/integration-services/event-hubs", label: t("tabEventHubs"), icon: <RadioTower className="w-4 h-4 text-[#0054A6]" /> },
    { href: "/intelligence/integration-services/adf", label: t("tabAdf"), icon: <Factory className="w-4 h-4 text-[#0054A6]" /> },
  ];

  return (
    <div className={inter.className}>
      <div className="px-6 pt-4">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Workflow className="w-6 h-6 text-[#0054A6]" />
          {t("title")}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("subtitle")}</p>
      </div>
      <RouteTabsNav tabs={tabs} className="px-6 mt-4 mb-4" />
      {children}
    </div>
  );
}
