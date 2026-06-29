import React from 'react';
import MockBanner from '@/components/MockBanner';
import AppServiceRightsizingTab from '@/components/dashboard/AppServiceRightsizingTab';

export default async function AppServiceRightsizingPage() {
    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">🌐</span>
                        Rightsizing App Service
                    </div>
                    <div className="vs">Planes de App Service sobre-dimensionados</div>
                </div>
            </div>
            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-6">
                <AppServiceRightsizingTab />
            </div>
        </div>
    );
}
