import ComputeServiceCostBoard from "@/components/dashboard/ComputeServiceCostBoard";
import { getTranslations } from "next-intl/server";

export default async function AroPage() {
    const t = await getTranslations("ComputeFamilies");
    return (
        <ComputeServiceCostBoard
            family="aro"
            title={t("aroTitle")}
            subtitle={t("aroSubtitle")}
        />
    );
}
