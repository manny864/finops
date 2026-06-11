import React from 'react';
import { FocusCostEntry } from '@/modules/core/focusMapper';

export default function FocusExecutiveSummaryCard({ title, entries, trend }: { title: string, entries: FocusCostEntry[], trend: string }) {
  const totalCost = entries.reduce((sum, entry) => sum + entry.EffectiveCost, 0);
  const formattedAmount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(totalCost);

  return (
    <div className="card !m-0 h-full p-6 border-l-4 border-[var(--brand)] flex flex-col justify-center" style={{ containerType: 'inline-size', containerName: 'card' }}>
      <div className="flex flex-col gap-2">
        <h3 className="text-gray-500 font-medium tracking-wide uppercase text-xs">{title}</h3>
        {/* Fluid typography using Container Query Units (cqi) */}
        <p className="font-bold text-gray-900" style={{ fontSize: 'clamp(1.5rem, 8cqi, 2.5rem)' }}>
          {formattedAmount}
        </p>
        <div className="text-sm font-medium text-green-600 bg-green-50 w-max px-2 py-1 rounded-md">
          {trend}
        </div>
      </div>
    </div>
  );
}
