import React from 'react';
import MockBanner from '@/components/MockBanner';
import WhatIfScenarioSimulator from '@/components/analytics/WhatIfScenarioSimulator';

export default function SimulatorPage() {
    return (
        <div className="w-full max-w-full space-y-4">
            <MockBanner />
            <WhatIfScenarioSimulator />
        </div>
    );
}
