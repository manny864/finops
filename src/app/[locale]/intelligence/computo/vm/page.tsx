import { Monitor } from "lucide-react";
import { getTranslations } from "next-intl/server";
import ComputeWorkloadBoard from "@/components/dashboard/ComputeWorkloadBoard";

export default async function AzureVirtualMachinesPage() {
    const t = await getTranslations("ComputeHub");
    return (
        <ComputeWorkloadBoard
            family="vms"
            title={t("virtualMachinesTitle")}
            subtitle={t("virtualMachinesSubtitle")}
            icon={<Monitor className="w-7 h-7 text-[#0054A6]" />}
            emptyTitle={t("emptyVirtualMachinesTitle")}
            emptyMessage={t("emptyVirtualMachinesSubtitle")}
        />
    );
}
