import React from "react";
import MockBanner from "@/components/MockBanner";
import AzureMongoDbFinopsBoard from "@/components/dashboard/AzureMongoDbFinopsBoard";

export default async function MongoDbPage() {
  return (
    <div className="content animate-in fade-in px-6 py-6">
      <MockBanner />
      <AzureMongoDbFinopsBoard />
    </div>
  );
}
