import React from "react";
import MockBanner from "@/components/MockBanner";
import AzureSqlFinopsBoard from "@/components/dashboard/AzureSqlFinopsBoard";

export default async function AzureSqlManagedInstancePage() {
  return (
    <div className="content animate-in fade-in px-6 py-6">
      <MockBanner />
      <AzureSqlFinopsBoard />
    </div>
  );
}

