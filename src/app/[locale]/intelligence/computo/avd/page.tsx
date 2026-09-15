import MockBanner from "@/components/MockBanner";
import AvdFinopsCmpBoard from "@/components/dashboard/AvdFinopsCmpBoard";
import { getTranslations } from "next-intl/server";
import { IconDeviceDesktopAnalytics } from "@tabler/icons-react";
import InfoTooltip from "@/components/InfoTooltip";

export default async function AzureVirtualDesktopFinopsCmpPage() {
  const t = await getTranslations("ComputeHub");
  const tAvd = await getTranslations("AvdFinopsCmp");

  return (
    <div className="content animate-in fade-in px-6 py-8">
      <MockBanner />
      <div className="mb-6">
        <h2 className="text-xl font-bold text-[#1B2A41] dark:text-slate-100 flex items-center gap-2">
          <IconDeviceDesktopAnalytics className="w-5 h-5 text-[#0054A6]" />
          <span>{t("avdFinopsTitle")}</span>
          <InfoTooltip content={tAvd("tooltip_page_header")} position="bottom" align="left" />
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("avdFinopsSubtitle")}</p>
      </div>
      <AvdFinopsCmpBoard />
    </div>
  );
}
