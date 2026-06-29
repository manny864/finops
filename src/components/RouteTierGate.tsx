"use client";
import React from 'react';
import { usePathname } from 'next/navigation';
import { Lock } from 'lucide-react';
import { useTenant } from './TenantProvider';
import { hasAccess } from '@/lib/tierLogic';
import { getRequiredTierForPath } from '@/lib/routeTiers';

/**
 * Bloquea acceso directo (por URL) a páginas que requieren un tier mayor al actual.
 * En modo demo, el tier viene del demoSession (Essential/Pro/Business/Enterprise).
 * SUPERADMIN bypassa siempre.
 */
export default function RouteTierGate({ children }: { children: React.ReactNode }) {
    const pathname = usePathname() || '/';
    const { selectedTenant, systemRole } = useTenant();

    const requiredTier = getRequiredTierForPath(pathname);
    const currentTier = (selectedTenant as any)?.tier || 'Essential';

    if (!requiredTier) return <>{children}</>;
    if (systemRole === 'SUPERADMIN') return <>{children}</>;
    if (hasAccess(currentTier, requiredTier)) return <>{children}</>;

    return (
        <div className="content animate-in fade-in">
            <div className="max-w-2xl mx-auto mt-10 bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/40 rounded-2xl p-8 shadow-sm">
                <div className="flex items-start gap-4">
                    <div className="p-3 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400">
                        <Lock className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1">
                            Función no disponible en tu plan
                        </h2>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                            Esta página está disponible a partir del plan <b>{requiredTier}</b>.
                            Tu plan actual es <b>{currentTier}</b>.
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-500">
                            Cambiá a un tenant con plan superior o actualizá tu suscripción para acceder.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
