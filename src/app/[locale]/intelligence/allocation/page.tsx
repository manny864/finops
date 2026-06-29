import React from 'react';
import MockBanner from '@/components/MockBanner';
import AllocationManager from '@/components/dashboard/AllocationManager';

export default function AllocationPage() {
    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-indigo-500 to-purple-600">🍕</span>
                        Shared Cost Allocation
                    </div>
                    <div className="vs">Define reglas de distribución para recursos compartidos y prorratea su costo exacto entre múltiples departamentos.</div>
                </div>
            </div>

            <div className="mt-6">
                <AllocationManager />
            </div>
        </div>
    );
}
