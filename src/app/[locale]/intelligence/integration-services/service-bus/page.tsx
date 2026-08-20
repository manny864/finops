import React from "react";
import MockBanner from "@/components/MockBanner";
import TelemetryDisclaimerBanner from "@/components/TelemetryDisclaimerBanner";
import ServiceBusFinopsDashboard from "@/components/dashboard/ServiceBusFinopsDashboard";

export default async function ServiceBusPage() {
  return (
    <div className="space-y-4">
      <MockBanner />
      <TelemetryDisclaimerBanner />
      <React.Suspense
        fallback={
          <div className="h-64 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        }
      >
        <ServiceBusFinopsDashboard />
      </React.Suspense>
    </div>
  );
}
