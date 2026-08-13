import MockBanner from "@/components/MockBanner";
import ComputeWorkloadFinopsCmpBoard from "@/components/dashboard/ComputeWorkloadFinopsCmpBoard";
import { getTranslations } from "next-intl/server";
import { Scaling } from "lucide-react";

export default async function VirtualMachineScaleSetsFinopsCmpPage() {
  const t = await getTranslations("ComputeHub");
  return (
    <div className="content animate-in fade-in px-6 py-8">
      <MockBanner />
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Scaling className="w-5 h-5 text-[#0054A6]" />
          {t("vmssFinopsTitle")}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {t("vmssFinopsSubtitle")}
        </p>
      </div>
      <ComputeWorkloadFinopsCmpBoard family="vmss" />
    </div>
  );
}
