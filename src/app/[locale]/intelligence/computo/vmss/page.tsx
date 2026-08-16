import MockBanner from "@/components/MockBanner";
import VmssFinopsCmpBoard from "@/components/dashboard/VmssFinopsCmpBoard";
import { getTranslations } from "next-intl/server";
import { IconServer2 } from "@tabler/icons-react";
import InfoTooltip from "@/components/InfoTooltip";

export default async function VirtualMachineScaleSetsFinopsCmpPage() {
  const t = await getTranslations("ComputeHub");
  return (
    <div className="content animate-in fade-in px-6 py-8">
      <MockBanner />
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <IconServer2 className="w-6 h-6 text-[#0054A6]" />
          <span>{t("vmssFinopsTitle")}</span>
          <InfoTooltip content={t("vmssFinopsSubtitle")} position="bottom" align="left" />
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {t("vmssFinopsSubtitle")}
        </p>
      </div>
      <VmssFinopsCmpBoard />
    </div>
  );
}
