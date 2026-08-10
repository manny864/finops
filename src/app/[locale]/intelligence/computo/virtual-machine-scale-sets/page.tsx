import { Scaling } from "lucide-react";
import { getTranslations } from "next-intl/server";
import ComputeWorkloadBoard from "@/components/dashboard/ComputeWorkloadBoard";

export default async function VirtualMachineScaleSetsPage() {
    const t = await getTranslations("ComputeHub");
    return (
        <ComputeWorkloadBoard
            family="vmss"
            title={t("vmssTitle")}
            subtitle={t("vmssSubtitle")}
            icon={<Scaling className="w-7 h-7 text-[#0054A6]" />}
            emptyTitle={t("emptyVmssTitle")}
            emptyMessage={t("emptyVmssSubtitle")}
        />
    );
}
