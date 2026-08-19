import { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import RouteTabsNav from "@/components/navigation/RouteTabsNav";
import {
  IconBrain,
  IconCpu,
  IconDatabase,
  IconEye,
  IconFileText,
  IconMicrophone,
  IconSearch,
  IconShieldExclamation,
} from "@tabler/icons-react";
import InfoTooltip from "@/components/InfoTooltip";

export default async function AzureAILayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("AzureAI");

  const tabs = [
    { href: "/intelligence/azure-ai", label: t("tab_overview"), icon: <IconBrain className="w-4 h-4 text-[#0078D4]" stroke={1.5} />, tooltip: t("tooltip_tab_overview") },
    { href: "/intelligence/azure-ai/foundry", label: t("tab_foundry"), icon: <IconDatabase className="w-4 h-4 text-[#0078D4]" stroke={1.5} />, tooltip: t("tooltip_tab_foundry") },
    { href: "/intelligence/azure-ai/search", label: t("tab_search"), icon: <IconSearch className="w-4 h-4 text-[#0078D4]" stroke={1.5} />, tooltip: t("tooltip_tab_search") },
    { href: "/intelligence/azure-ai/document-intelligence", label: t("tab_document_intelligence"), icon: <IconFileText className="w-4 h-4 text-[#0078D4]" stroke={1.5} />, tooltip: t("tooltip_tab_document_intelligence") },
    { href: "/intelligence/azure-ai/speech-language", label: t("tab_speech_language"), icon: <IconMicrophone className="w-4 h-4 text-[#0078D4]" stroke={1.5} />, tooltip: t("tooltip_tab_speech_language") },
    { href: "/intelligence/azure-ai/vision-video", label: t("tab_vision_video"), icon: <IconEye className="w-4 h-4 text-[#0078D4]" stroke={1.5} />, tooltip: t("tooltip_tab_vision_video") },
    { href: "/intelligence/azure-ai/content-safety", label: t("tab_content_safety"), icon: <IconShieldExclamation className="w-4 h-4 text-[#0078D4]" stroke={1.5} />, tooltip: t("tooltip_tab_content_safety") },
    { href: "/intelligence/azure-ai/aml", label: t("tab_aml"), icon: <IconCpu className="w-4 h-4 text-[#0078D4]" stroke={1.5} />, tooltip: t("tooltip_tab_aml") },
    { href: "/intelligence/azure-ai/databricks", label: t("tab_databricks"), icon: <IconDatabase className="w-4 h-4 text-[#0078D4]" stroke={1.5} />, tooltip: t("tooltip_tab_databricks") },
  ];

  return (
    <div className="content animate-in fade-in">
      <div className="vhead">
        <div>
          <div className="vt flex items-center gap-2">
            <span className="vico !bg-transparent !shadow-none">
              <IconBrain className="h-5 w-5 text-[#0078D4]" stroke={1.5} />
            </span>
            <span>{t("title")}</span>
            <InfoTooltip content={t("tooltip_title")} position="bottom" align="left" />
          </div>
          <div className="vs">{t("subtitle")}</div>
        </div>
      </div>
      <RouteTabsNav tabs={tabs} className="mt-4 mb-4" />
      {children}
    </div>
  );
}
