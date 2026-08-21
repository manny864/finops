"use client";

import dynamic from "next/dynamic";

const VisionVideoDashboard = dynamic(
  () => import("@/components/dashboard/VisionVideoDashboard"),
  { ssr: false, loading: () => <div className="h-64 bg-slate-100 dark:bg-slate-800 animate-pulse rounded-xl" /> }
);

export function VisionVideoTab({ tenantId }: { tenantId: string }) {
  return <VisionVideoDashboard />;
}

