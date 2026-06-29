import React from 'react';
import MockBanner from '@/components/MockBanner';
import UnitEconomics from '@/components/dashboard/UnitEconomics';

export default function UnitEconomicsPage() {
    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#0054A6] to-[#00AEEF]">📊</span>
                        Unit Economics
                    </div>
                    <div className="vs">Correlación entre el gasto de infraestructura cloud y el valor transaccional del negocio.</div>
                </div>
            </div>

            <div className="mt-6">
                <UnitEconomics />
            </div>
        </div>
    );
}
