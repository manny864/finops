import React from 'react';
import MockBanner from '@/components/MockBanner';
import FinOpsScorecard from '@/components/dashboard/FinOpsScorecard';

export default function ScorecardPage() {
    return (
        <div className="content animate-in fade-in">
            <MockBanner />
            <div className="vhead">
                <div>
                    <div className="vt">
                        <span className="vico bg-gradient-to-br from-[#F59E0B] to-[#D97706]">🏆</span>
                        FinOps Scorecard & Leaderboard
                    </div>
                    <div className="vs">Muro de la Fama. Fomenta la responsabilidad financiera comparando la eficiencia y limpieza de recursos entre tus equipos.</div>
                </div>
            </div>

            <div className="mt-6">
                <FinOpsScorecard />
            </div>
        </div>
    );
}
