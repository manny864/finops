import { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import RouteTabsNav from "@/components/navigation/RouteTabsNav";
import { BrainCircuit, Search, FileText, Mic, Eye, ShieldAlert, Cpu, Database } from "lucide-react";
import InfoTooltip from "@/components/InfoTooltip";

export default async function AzureAILayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("AzureAI");

  const tabs = [
    { href: "/intelligence/azure-ai", label: t("tab_overview"), icon: <BrainCircuit className="w-4 h-4 text-[#0078d4]" />, tooltip: t("tooltip_tab_overview") },
    { href: "/intelligence/azure-ai/foundry", label: t("tab_foundry"), icon: <Database className="w-4 h-4 text-[#0078d4]" />, tooltip: t("tooltip_tab_foundry") },
    { href: "/intelligence/azure-ai/search", label: t("tab_search"), icon: <Search className="w-4 h-4 text-[#0078d4]" />, tooltip: t("tooltip_tab_search") },
    { href: "/intelligence/azure-ai/document-intelligence", label: t("tab_document_intelligence"), icon: <FileText className="w-4 h-4 text-[#0078d4]" />, tooltip: t("tooltip_tab_document_intelligence") },
    { href: "/intelligence/azure-ai/speech-language", label: t("tab_speech_language"), icon: <Mic className="w-4 h-4 text-[#0078d4]" />, tooltip: t("tooltip_tab_speech_language") },
    { href: "/intelligence/azure-ai/vision-video", label: t("tab_vision_video"), icon: <Eye className="w-4 h-4 text-[#0078d4]" />, tooltip: t("tooltip_tab_vision_video") },
    { href: "/intelligence/azure-ai/content-safety", label: t("tab_content_safety"), icon: <ShieldAlert className="w-4 h-4 text-[#0078d4]" />, tooltip: t("tooltip_tab_content_safety") },
    { href: "/intelligence/azure-ai/aml", label: t("tab_aml"), icon: <Cpu className="w-4 h-4 text-[#0078d4]" />, tooltip: t("tooltip_tab_aml") },
    { href: "/intelligence/azure-ai/databricks", label: t("tab_databricks"), icon: <Database className="w-4 h-4 text-[#0078d4]" />, tooltip: t("tooltip_tab_databricks") },
  ];

  return (
    <div className="content animate-in fade-in">
      <div className="vhead">
        <div>
          <div className="vt flex items-center gap-2">
            <span className="vico bg-gradient-to-br from-[#0078d4] to-[#50e6ff]">
              <BrainCircuit className="h-5 w-5" />
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
