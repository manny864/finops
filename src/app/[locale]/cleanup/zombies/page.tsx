import { getTranslations } from "next-intl/server";
import MockBanner from '@/components/MockBanner';
import ZombieResourcesTable from "@/components/ZombieResourcesTable";

export default async function ZombiesPage() {
  const t = await getTranslations("Zombies");
  return (
    <div className="p-6">
      <MockBanner />
      <h1 className="text-2xl font-bold mb-4 text-gray-900">{t("pageTitle")}</h1>
      <p className="text-sm text-gray-500 mb-6">{t("pageSubtitle")}</p>
      <ZombieResourcesTable />
    </div>
  );
}
