import React from "react";
import { notFound } from "next/navigation";
import MockBanner from "@/components/MockBanner";
import AzureAIDashboard, { type Capability } from "../components/AzureAIDashboard";

const SLUG_TO_CAPABILITY: Record<string, Capability> = {
  search: "search",
  "document-intelligence": "document-intelligence",
  "speech-language": "speech-language",
  "vision-video": "vision-video",
  "content-safety": "content-safety",
  aml: "aml",
  databricks: "databricks",
};

export default async function AzureAICapabilityPage({
  params,
}: {
  params: Promise<{ capability: string }>;
}) {
  const { capability } = await params;
  const initialTab = SLUG_TO_CAPABILITY[capability];

  if (!initialTab) {
    notFound();
  }

  return (
    <div>
      <MockBanner />
      <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-2">
        <React.Suspense fallback={<div className="h-64 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />}>
          <AzureAIDashboard initialTab={initialTab} />
        </React.Suspense>
      </div>
    </div>
  );
}
