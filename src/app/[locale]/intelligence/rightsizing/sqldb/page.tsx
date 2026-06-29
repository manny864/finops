import React from 'react';
import MockBanner from '@/components/MockBanner';
import SqlDbRightsizingTab from '@/components/dashboard/SqlDbRightsizingTab';

export default async function SqlDbRightsizingPage() {
    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">🗄️</span>
                        Rightsizing SQL Database
                    </div>
                    <div className="vs">Bases SQL con DTUs ociosas o tier inadecuado</div>
                </div>
            </div>
            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-6">
                <SqlDbRightsizingTab />
            </div>
        </div>
    );
}
