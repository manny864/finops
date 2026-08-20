import React from "react";
import MockBanner from "@/components/MockBanner";
import TelemetryDisclaimerBanner from "@/components/TelemetryDisclaimerBanner";
import VisionVideoDashboard from "@/components/dashboard/VisionVideoDashboard";

export default async function VisionVideoPage() {
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
          <VisionVideoDashboard />
        </React.Suspense>
      </div>
    </div>
  );
}
