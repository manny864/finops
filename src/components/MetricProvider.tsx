"use client";
import React, { createContext, useContext, useState, useEffect } from 'react';

type MetricType = 'ActualCost' | 'AmortizedCost';

interface MetricContextType {
    metricType: MetricType;
    setMetricType: (type: MetricType) => void;
}

const MetricContext = createContext<MetricContextType>({
    metricType: 'ActualCost',
    setMetricType: () => {}
});

export const useMetric = () => useContext(MetricContext);

export function MetricProvider({ children }: { children: React.ReactNode }) {
    const [metricType, setMetricType] = useState<MetricType>('ActualCost');
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        const saved = localStorage.getItem('finops_metric_preference') as MetricType;
        if (saved && (saved === 'ActualCost' || saved === 'AmortizedCost')) {
            setMetricType(saved);
        }
        setMounted(true);
    }, []);

    const updateMetric = (type: MetricType) => {
        setMetricType(type);
        localStorage.setItem('finops_metric_preference', type);
    };

    // Return default (ActualCost) on server-side to avoid hydration mismatch,
    // though the Context Provider will just pass whatever initial state we have.
    // The inner UI components will handle showing it.
    return (
        <MetricContext.Provider value={{ metricType, setMetricType: updateMetric }}>
            {children}
        </MetricContext.Provider>
    );
}
