import React from 'react';
import PoliciesAsCode from '@/components/dashboard/PoliciesAsCode';

export default function PoliciesPage() {
    return (
        <div className="content animate-in fade-in">
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-red-500 to-rose-600">🛡️</span>
                        Policies as Code
                    </div>
                    <div className="vs">Despliega restricciones automatizadas mediante Azure Policy para prevenir gastos indeseados desde el momento del aprovisionamiento.</div>
                </div>
            </div>

            <div className="mt-6">
                <PoliciesAsCode />
            </div>
        </div>
    );
}
