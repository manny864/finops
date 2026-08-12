import { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import RouteTabsNav from "@/components/navigation/RouteTabsNav";
import { BrainCircuit, Search, FileText, Mic, Eye, ShieldAlert, Cpu, Database } from "lucide-react";

export default async function AzureAILayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("AzureAI");

  const tabs = [
    { href: "/intelligence/azure-ai", label: "Overview", icon: <BrainCircuit className="w-4 h-4 text-[#0078d4]" /> },
    { href: "/intelligence/azure-ai/search", label: "AI Search", icon: <Search className="w-4 h-4 text-[#0078d4]" /> },
    { href: "/intelligence/azure-ai/document-intelligence", label: "Document Intelligence", icon: <FileText className="w-4 h-4 text-[#0078d4]" /> },
    { href: "/intelligence/azure-ai/speech-language", label: "Speech & Language", icon: <Mic className="w-4 h-4 text-[#0078d4]" /> },
    { href: "/intelligence/azure-ai/vision-video", label: "Vision & Video", icon: <Eye className="w-4 h-4 text-[#0078d4]" /> },
    { href: "/intelligence/azure-ai/content-safety", label: "Content Safety", icon: <ShieldAlert className="w-4 h-4 text-[#0078d4]" /> },
    { href: "/intelligence/azure-ai/aml", label: "Machine Learning", icon: <Cpu className="w-4 h-4 text-[#0078d4]" /> },
    { href: "/intelligence/azure-ai/databricks", label: "Databricks", icon: <Database className="w-4 h-4 text-[#0078d4]" /> },
  ];

  return (
    <div className="content animate-in fade-in">
      <div className="vhead">
        <div>
          <div className="vt">
            <span className="vico bg-gradient-to-br from-[#0078d4] to-[#50e6ff]">
              <BrainCircuit className="h-5 w-5" />
            </span>
            {t("title")}
          </div>
          <div className="vs">{t("subtitle")}</div>
        </div>
      </div>
      <RouteTabsNav tabs={tabs} className="mt-4 mb-4" />
      {children}
    </div>
  );
}
