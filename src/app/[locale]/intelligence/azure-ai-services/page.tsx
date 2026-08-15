"use client";

import { useState, useEffect } from "react";
import { useTenant } from "@/components/TenantProvider";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import MockBanner from "@/components/MockBanner";
import { isMockTenant } from "@/lib/mockData";
import { AzureSearchTab } from "./tabs/AzureSearchTab";
import { DocumentIntelligenceTab } from "./tabs/DocumentIntelligenceTab";
import { SpeechLanguageTab } from "./tabs/SpeechLanguageTab";
import { VisionVideoTab } from "./tabs/VisionVideoTab";
import { ContentSafetyTab } from "./tabs/ContentSafetyTab";
import { AMLTab } from "./tabs/AMLTab";
import { DatabricksTab } from "./tabs/DatabricksTab";

export default function AzureAIServicesPage() {
  const t = useTranslations("AzureAI");
  const { selectedTenant } = useTenant();
  const [activeTab, setActiveTab] = useState("search");

  if (selectedTenant.id === "default") {
    return (
      <div className="p-6 max-w-full">
        <div className="text-center text-muted-foreground">
          {t("select_tenant") || "Please select a tenant"}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-full space-y-6">
      <MockBanner />
      
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Azure AI Services</h1>
        <p className="text-muted-foreground">
          Cost analysis, inventory, and optimization insights for all Azure AI services
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b">
        {[
          { id: "search", label: "Search" },
          { id: "doc-intel", label: "Document Intelligence" },
          { id: "speech", label: "Speech & Language" },
          { id: "vision", label: "Vision & Video" },
          { id: "content-safety", label: "Content Safety" },
          { id: "aml", label: "Machine Learning" },
          { id: "databricks", label: "Databricks" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div>
        {activeTab === "search" && <AzureSearchTab tenantId={selectedTenant.id} />}
        {activeTab === "doc-intel" && <DocumentIntelligenceTab tenantId={selectedTenant.id} />}
        {activeTab === "speech" && <SpeechLanguageTab tenantId={selectedTenant.id} />}
        {activeTab === "vision" && <VisionVideoTab tenantId={selectedTenant.id} />}
        {activeTab === "content-safety" && <ContentSafetyTab tenantId={selectedTenant.id} />}
        {activeTab === "aml" && <AMLTab tenantId={selectedTenant.id} />}
        {activeTab === "databricks" && <DatabricksTab tenantId={selectedTenant.id} />}
      </div>
    </div>
  );
}
