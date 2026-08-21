"use client";

import dynamic from "next/dynamic";

const ContentSafetyDashboard = dynamic(
  () => import("@/components/dashboard/ContentSafetyDashboard"),
  { ssr: false, loading: () => <div className="h-64 bg-slate-100 dark:bg-slate-800 animate-pulse rounded-xl" /> }
);

export function ContentSafetyTab({ tenantId }: { tenantId: string }) {
  return <ContentSafetyDashboard />;
}

