"use client";
import MockBanner from '@/components/MockBanner';
import RatesOptimization from '@/components/dashboard/RatesOptimization';

export default function RateOptimizationPage() {
    return (
        <div className="p-6 max-w-full">
            <MockBanner />
            <RatesOptimization />
        </div>
    );
}
