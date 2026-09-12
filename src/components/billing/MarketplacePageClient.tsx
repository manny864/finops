"use client";

import React from "react";
import { useTenant } from "@/components/TenantProvider";
import { isMockTenant } from "@/lib/mockData";
import AddonsMarketplace from "@/components/billing/AddonsMarketplace";
import type { SaaSPlanTier } from "@/types/saasBilling.types";

export default function MarketplacePageClient() {
    const { selectedTenant } = useTenant();
    const tenantId = selectedTenant?.id || "";
    const isMock = isMockTenant(tenantId);
    const currentTier = (selectedTenant?.tier as SaaSPlanTier) || "Professional";

    return (
        <AddonsMarketplace
            tenantId={tenantId}
            isMock={isMock}
            currentTier={currentTier}
            className="mt-0"
        />
    );
}
