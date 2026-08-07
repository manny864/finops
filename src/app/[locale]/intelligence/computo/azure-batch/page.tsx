import ComputeServiceCostBoard from "@/components/dashboard/ComputeServiceCostBoard";
import { getTranslations } from "next-intl/server";

export default async function AzureBatchPage() {
    const t = await getTranslations("ComputeFamilies");
    return (
        <ComputeServiceCostBoard
            family="batch"
            title={t("batchTitle")}
            subtitle={t("batchSubtitle")}
        />
    );
}
