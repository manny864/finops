import React, { Suspense } from "react";
import MockBanner from "@/components/MockBanner";
import MicrosoftFabricDashboard from "./components/MicrosoftFabricDashboard";

export default async function MicrosoftFabricPage() {
  return (
    <div className="content animate-in fade-in px-6 py-6">
      <MockBanner />
      <Suspense fallback={<div className="text-center py-8 text-slate-500">Cargando métricas de Microsoft Fabric...</div>}>
        <MicrosoftFabricDashboard />
      </Suspense>
    </div>
  );
}
