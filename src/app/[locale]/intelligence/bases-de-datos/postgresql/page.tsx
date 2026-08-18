import React from "react";
import MockBanner from "@/components/MockBanner";
import AzurePostgreSqlFinopsBoard from "@/components/dashboard/AzurePostgreSqlFinopsBoard";

export default async function PostgresPage() {
  return (
    <div className="content animate-in fade-in px-6 py-6">
      <MockBanner />
      <AzurePostgreSqlFinopsBoard />
    </div>
  );
}
