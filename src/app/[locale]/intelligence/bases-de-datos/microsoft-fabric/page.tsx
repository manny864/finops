import MockBanner from "@/components/MockBanner";
import { getTranslations } from "next-intl/server";
import { SquareStack } from "lucide-react";
import dynamic from "next/dynamic";
import { Suspense } from "react";

const MicrosoftFabricDashboard = dynamic(
  () => import("./components/MicrosoftFabricDashboard")
);

export default async function MicrosoftFabricPage() {
  const t = await getTranslations("DatabasesHub");
  
  return (
    <div className="content animate-in fade-in px-6 py-8">
      <MockBanner />
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <SquareStack className="w-5 h-5 text-[#6B35C1]" />
          {t("fabricTitle") || "Microsoft Fabric"}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {t("fabricSubtitle") || "Analytics platform with unified capacity and OneLake storage"}
        </p>
      </div>
      <Suspense fallback={<div className="text-center py-8">Loading Fabric metrics...</div>}>
        <MicrosoftFabricDashboard />
      </Suspense>
    </div>
  );
}
