import StorageServiceCostBoard from "@/components/dashboard/StorageServiceCostBoard";
import { getTranslations } from "next-intl/server";
import { Database } from "lucide-react";

export default async function DataLakeStoragePage() {
    const t = await getTranslations("StorageFamilies");
    return (
        <StorageServiceCostBoard
            family="data-lake-gen2"
            title={t("dataLakeTitle")}
            subtitle={t("dataLakeSubtitle")}
            icon={<Database className="w-7 h-7 text-[#0054A6]" />}
        />
    );
}
