import React from 'react';
import MockBanner from '@/components/MockBanner';
import AksIntelligence from '@/components/dashboard/AksIntelligence';

export default function AksPage() {
    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">⚙️</span>
                        Inteligencia de AKS
                    </div>
                    <div className="vs">Auditoría de gasto estructural y visibilidad de clústeres de Kubernetes (AKS)</div>
                </div>
            </div>

            <div className="mt-6">
                <AksIntelligence />
            </div>
        </div>
    );
}
