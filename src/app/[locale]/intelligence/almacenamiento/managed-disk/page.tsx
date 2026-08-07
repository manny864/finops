import StorageServiceCostBoard from "@/components/dashboard/StorageServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { HardDrive } from "lucide-react";

export default async function ManagedDiskPage() {
    const t = await getTranslations("StorageFamilies");
    return (
        <StorageServiceCostBoard
            family="managed-disks"
            title={t("managedDiskTitle")}
            subtitle={t("managedDiskSubtitle")}
            icon={<HardDrive className="w-7 h-7 text-[#0054A6]" />}
        />
    );
}
