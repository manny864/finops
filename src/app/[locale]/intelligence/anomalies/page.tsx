import React from 'react';
import MockBanner from '@/components/MockBanner';
import AnomalyDetectionPanel from '@/components/analytics/AnomalyDetectionPanel';

export default function AnomaliesPage() {
    return (
        <div className="w-full max-w-full space-y-4">
            <MockBanner />
            <AnomalyDetectionPanel />
        </div>
    );
}
