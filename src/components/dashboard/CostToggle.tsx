"use client";
import React from 'react';
import { useMetric } from '@/components/MetricProvider';
import { useTranslations } from 'next-intl';

export default function CostToggle() {
    const { metricType, setMetricType } = useMetric();
    const isAmortized = metricType === 'AmortizedCost';

    // Toggle handler
    const toggle = () => {
        setMetricType(isAmortized ? 'ActualCost' : 'AmortizedCost');
    };

    return (
        <div className="flex items-center bg-surface-2 rounded-lg p-1 border border-line">
            <button
                onClick={() => setMetricType('ActualCost')}
                className={`flex items-center px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${
                    !isAmortized ? 'bg-white shadow-sm text-brand-deep' : 'text-gray-500 hover:text-gray-700'
                }`}
            >
                Costo Real
            </button>
            <button
                onClick={() => setMetricType('AmortizedCost')}
                className={`flex items-center px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${
                    isAmortized ? 'bg-white shadow-sm text-brand-deep' : 'text-gray-500 hover:text-gray-700'
                }`}
            >
                Amortizado
            </button>
        </div>
    );
}
