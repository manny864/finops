import React from 'react';
import MockBanner from '@/components/MockBanner';
import StorageRightsizingTab from '@/components/dashboard/StorageRightsizingTab';

export default async function StorageRightsizingPage() {
    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">💾</span>
                        Rightsizing Storage
                    </div>
                    <div className="vs">Cuentas de Storage con tier inadecuado para el patrón de acceso</div>
                </div>
            </div>
            <div className="p-6 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm mt-6">
                <StorageRightsizingTab />
            </div>
        </div>
    );
}
