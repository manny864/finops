import React, { Suspense } from "react";
import MockBanner from "@/components/MockBanner";
import MicrosoftFabricDashboard from "./components/MicrosoftFabricDashboard";
import { getTranslations } from "next-intl/server";

export default async function MicrosoftFabricPage() {
  const t = await getTranslations("MicrosoftFabric");
  return (
    <div className="content animate-in fade-in px-6 py-6">
      <MockBanner />
      <Suspense fallback={<div className="text-center py-8 text-slate-500">{t("loadingMetrics")}</div>}>
        <MicrosoftFabricDashboard />
      </Suspense>
    </div>
  );
}
