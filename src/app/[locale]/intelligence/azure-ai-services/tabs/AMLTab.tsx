"use client";

import dynamic from "next/dynamic";

const AMLDashboard = dynamic(
  () => import("@/components/dashboard/AMLDashboard"),
  { ssr: false, loading: () => <div className="h-64 bg-slate-100 dark:bg-slate-800 animate-pulse rounded-xl" /> }
);

export function AMLTab({ tenantId }: { tenantId: string }) {
  return <AMLDashboard />;
}

