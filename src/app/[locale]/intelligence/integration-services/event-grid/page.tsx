import React from "react";
import MockBanner from "@/components/MockBanner";
import TelemetryDisclaimerBanner from "@/components/TelemetryDisclaimerBanner";
import EventGridFinopsDashboard from "@/components/dashboard/EventGridFinopsDashboard";

export default async function EventGridPage() {
  return (
    <div className="space-y-4">
      <MockBanner />
      <TelemetryDisclaimerBanner />
      <React.Suspense
        fallback={
          <div className="h-64 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        }
      >
        <EventGridFinopsDashboard />
      </React.Suspense>
    </div>
  );
}
