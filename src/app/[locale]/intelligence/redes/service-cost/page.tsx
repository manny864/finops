"use client";

import NetworkServiceCostBoard from "@/components/dashboard/NetworkServiceCostBoard";
import { IconChartPie } from "@tabler/icons-react";

export default function ServiceCostPage() {
    return (
        <NetworkServiceCostBoard
            family="analysis"
            title="Network Service Cost"
            subtitle="Consolidated cost breakdown across all network service families"
            icon={<IconChartPie className="w-5 h-5 text-[#0054A6]" stroke={1.5} />}
            apiPath="/api/intelligence/network/service-cost"
        />
    );
}