import React from 'react';
import MockBanner from '@/components/MockBanner';
import FinOpsScorecardPanel from '@/components/analytics/FinOpsScorecardPanel';

export default async function ScorecardPage() {
    return (
        <div className="content animate-in fade-in w-full max-w-full">
            <MockBanner />
            <FinOpsScorecardPanel />
        </div>
    );
}
