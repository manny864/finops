"use client";

import dynamic from "next/dynamic";

const DatabricksDashboard = dynamic(
  () => import("@/components/dashboard/DatabricksDashboard"),
  { ssr: false, loading: () => <div className="h-64 bg-slate-100 dark:bg-slate-800 animate-pulse rounded-xl" /> }
);

export function DatabricksTab({ tenantId }: { tenantId: string }) {
  return <DatabricksDashboard />;
}

