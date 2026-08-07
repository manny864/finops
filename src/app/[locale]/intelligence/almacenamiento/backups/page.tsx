import StorageServiceCostBoard from "@/components/dashboard/StorageServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";

export default async function BackupsPage() {
    const t = await getTranslations("StorageFamilies");
    return (
        <StorageServiceCostBoard
            family="backups"
            title={t("backupsTitle")}
            subtitle={t("backupsSubtitle")}
            icon={<ShieldCheck className="w-7 h-7 text-[#0054A6]" />}
        />
    );
}
