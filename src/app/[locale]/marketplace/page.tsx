import React from "react";
import MockBanner from "@/components/MockBanner";
import MarketplacePageClient from "@/components/billing/MarketplacePageClient";

export default function MarketplacePage() {
    return (
        <div className="content animate-in fade-in space-y-6">
            <MockBanner />
            <MarketplacePageClient />
        </div>
    );
}
