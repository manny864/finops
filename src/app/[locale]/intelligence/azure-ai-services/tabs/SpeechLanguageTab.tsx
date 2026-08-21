"use client";

import dynamic from "next/dynamic";

const SpeechLanguageDashboard = dynamic(
  () => import("@/components/dashboard/SpeechLanguageDashboard"),
  { ssr: false, loading: () => <div className="h-64 bg-slate-100 dark:bg-slate-800 animate-pulse rounded-xl" /> }
);

export function SpeechLanguageTab({ tenantId }: { tenantId: string }) {
  return <SpeechLanguageDashboard />;
}
