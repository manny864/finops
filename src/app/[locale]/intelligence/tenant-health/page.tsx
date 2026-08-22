import React from "react";
import MockBanner from "@/components/MockBanner";
import TenantHealthPanel from "@/components/analytics/TenantHealthPanel";

export default function TenantHealthPage() {
    return (
        <div className="w-full max-w-full space-y-4">
            <MockBanner />
            <TenantHealthPanel />
        </div>
    );
}
