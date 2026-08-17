import MockBanner from "@/components/MockBanner";
import VmFinopsCmpBoard from "@/components/dashboard/VmFinopsCmpBoard";
import { getTranslations } from "next-intl/server";
import { IconServer2 } from "@tabler/icons-react";
import InfoTooltip from "@/components/InfoTooltip";

export default async function AzureVirtualMachinesFinopsCmpPage() {
  const t = await getTranslations("ComputeHub");
  const tVm = await getTranslations("VmFinopsCmp");

  return (
    <div className="content animate-in fade-in px-6 py-8">
      <MockBanner />
      <div className="mb-6">
        <h2 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
          <IconServer2 className="w-5 h-5 text-[#0054A6]" />
          <span>{t("virtualMachinesFinopsTitle")}</span>
          <InfoTooltip content={tVm("tooltip_page_header")} position="bottom" align="left" />
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {t("virtualMachinesFinopsSubtitle")}
        </p>
      </div>
      <VmFinopsCmpBoard />
    </div>
  );
}
