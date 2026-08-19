import React from "react";
import MockBanner from "@/components/MockBanner";
import TelemetryDisclaimerBanner from "@/components/TelemetryDisclaimerBanner";

const AzureAISearch = React.lazy(() => import("../components/AzureAISearch"));

export default async function AzureAISearchPage() {
  return (
    <div className="space-y-4">
      <MockBanner />
      <TelemetryDisclaimerBanner />
      <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm">
        <React.Suspense
          fallback={
            <div className="h-64 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
          }
        >
          <AzureAISearch />
        </React.Suspense>
      </div>
    </div>
  );
}