import React from "react";
import MockBanner from '@/components/MockBanner';

const AzureAIDashboard = React.lazy(() => import("./components/AzureAIDashboard"));

export default async function AzureAIPage() {
    return (
        <div>
            <MockBanner />
            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-2">
                <React.Suspense fallback={<div className="h-64 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />}>
                    <AzureAIDashboard initialTab="search" showInternalTabs={false} />
                </React.Suspense>
            </div>
        </div>
    );
}
