import React from "react";
import MockBanner from "@/components/MockBanner";
import RealConsumptionDashboard from "@/components/dashboard/RealConsumptionDashboard";

export default function ConsumoRealPage() {
    return (
        <div className="content animate-in fade-in space-y-6">
            <MockBanner />
            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm">
                <RealConsumptionDashboard />
            </div>
        </div>
    );
}

