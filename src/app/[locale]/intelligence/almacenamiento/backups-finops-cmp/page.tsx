import MockBanner from "@/components/MockBanner";
import StorageFinopsCmpBoard from "@/components/dashboard/StorageFinopsCmpBoard";
import { getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";

export default async function BackupsFinopsCmpPage() {
  const t = await getTranslations("StorageHub");
  return (
    <div className="content animate-in fade-in px-6 py-8">
      <MockBanner />
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-[#0054A6]" />
          {t("backupsFinopsTitle")}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("backupsFinopsSubtitle")}</p>
      </div>
      <StorageFinopsCmpBoard family="backups" />
    </div>
  );
}

