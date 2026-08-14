"use client";
import React, { useState } from 'react';
import { useTenant } from './TenantProvider';
import { hasAccess } from '@/lib/tierLogic';
import TierLockedNotice from './TierLockedNotice';

interface FeatureGuardProps {
    children: React.ReactNode;
    requiredTier: string;
    featureName?: string;
    className?: string;
}

export default function FeatureGuard({ children, requiredTier, featureName, className }: FeatureGuardProps) {
    const { selectedTenant, systemRole } = useTenant();
    const currentTier = (selectedTenant as any).tier || 'Professional';
    const [showNotice, setShowNotice] = useState(false);

    if (systemRole === 'SUPERADMIN' || hasAccess(currentTier, requiredTier)) {
        return (
            <div className={`h-full w-full ${className || ''}`}>
                {children}
            </div>
        );
    }

    return (
        <>
            {/* Borde + fondo crisp en el wrapper (NO en el hijo, que va borroso) para
                que la tarjeta bloqueada tenga un contenedor visible y no se funda con
                el fondo oscuro. overflow-hidden contiene el blur del contenido. Clickeable
                (sin candado) — al hacer click muestra el detalle de qué plan lo desbloquea. */}
            <div
                role="button"
                tabIndex={0}
                onClick={() => setShowNotice(true)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowNotice(true); } }}
                className={`relative group cursor-pointer rounded-[14px] border border-[var(--line)] bg-[var(--surface)] overflow-hidden ${className || 'mb-1'}`}
            >
                <div className="opacity-40 grayscale pointer-events-none blur-[1px] transition-all h-full w-full">
                    {children}
                </div>
            </div>

            {showNotice && (
                <div
                    className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
                    onClick={() => setShowNotice(false)}
                >
                    <div className="max-w-md w-full" onClick={(e) => e.stopPropagation()}>
                        <TierLockedNotice requiredTier={requiredTier} currentTier={currentTier} featureName={featureName} />
                    </div>
                </div>
            )}
        </>
    );
}
