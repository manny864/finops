"use client";
import React, { useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useProviderTranslations } from '@/lib/useProviderTranslations';

export default function RbacLockTooltip({ children }: { children: React.ReactNode }) {
  const { requiresRbacUpdate } = useTenant();
  const t = useProviderTranslations('Common');
  const [showTooltip, setShowTooltip] = useState(false);

  if (!requiresRbacUpdate) {
    return <>{children}</>;
  }

  return (
    <div 
      className="relative inline-block"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClickCapture={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="opacity-50 cursor-not-allowed pointer-events-none">
        {children}
      </div>
      {showTooltip && (
        <div className="absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 text-xs font-medium text-white bg-gray-900 rounded-md shadow-lg whitespace-nowrap">
          {t('rbacUpdateRequired')}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
        </div>
      )}
    </div>
  );
}
