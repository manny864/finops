import React from 'react';
import HybridBenefitCard from '@/components/dashboard/HybridBenefitCard';
import MockBanner from '@/components/MockBanner';

export default function HybridBenefitPage() {
    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-green-500 to-emerald-600">🏷️</span>
                        Azure Hybrid Benefit Scanner
                    </div>
                    <div className="vs">Identifica instancias pagando precio de lista y simula tu ahorro al reutilizar licencias on-premise con Software Assurance.</div>
                </div>
            </div>

            <div className="mt-6">
                <HybridBenefitCard />
            </div>
        </div>
    );
}
