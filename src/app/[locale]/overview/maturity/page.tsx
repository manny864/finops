"use client";

import dynamic from "next/dynamic";
import MockBanner from "@/components/MockBanner";

const MaturityDashboard = dynamic(
  () => import("@/components/dashboard/MaturityDashboard"),
  {
    ssr: false,
    loading: () => (
      <div className="h-96 bg-slate-100 dark:bg-slate-800 animate-pulse rounded-xl" />
    ),
  }
);

export default function MaturityPage() {
  return (
    <div className="p-6 max-w-[1320px] mx-auto space-y-6">
      <MockBanner />
      <MaturityDashboard />
    </div>
  );
}

