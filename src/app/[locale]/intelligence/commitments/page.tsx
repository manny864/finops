import React from 'react';
import Commitments from '@/components/dashboard/Commitments';
import MockBanner from '@/components/MockBanner';

export default function CommitmentsPage() {
    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#10B981] to-[#047857]">🔖</span>
                        Descuentos por Compromiso (RIs & Savings Plans)
                    </div>
                    <div className="vs">Analiza la cobertura y utilización financiera de las reservas en tu infraestructura.</div>
                </div>
            </div>

            <div className="mt-6">
                <Commitments />
            </div>
        </div>
    );
}
