import React from "react";
import MockBanner from "@/components/MockBanner";
import BillingDashboard from "@/components/dashboard/BillingDashboard";

export default function ConsumoRealPage() {
    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-6">
                <BillingDashboard initialTab="real" hideTabs />
            </div>
        </div>
    );
}
