import React from "react";
import MockBanner from "@/components/MockBanner";
import TelemetryDisclaimerBanner from "@/components/TelemetryDisclaimerBanner";
import ContentSafetyDashboard from "@/components/dashboard/ContentSafetyDashboard";

export default async function ContentSafetyPage() {
  return (
    <div className="space-y-4">
      <MockBanner />
      <TelemetryDisclaimerBanner />
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <React.Suspense
          fallback={
            <div className="h-64 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          }
        >
          <ContentSafetyDashboard />
        </React.Suspense>
      </div>
    </div>
  );
}
