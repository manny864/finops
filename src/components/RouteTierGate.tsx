"use client";
import React from 'react';
import { usePathname } from 'next/navigation';
import { Lock, ShieldOff } from 'lucide-react';
import { useTenant } from './TenantProvider';
import { hasAccess } from '@/lib/tierLogic';
import { getRequiredTierForPath, stripLocale } from '@/lib/routeTiers';
import { getTagsForRoute, hasAnyTag, ROLE_TAG_META } from '@/lib/pageRoleTags';

// Rutas siempre accesibles con cualquier combinación de rol/permisos
// (mismo criterio que Sidebar.tsx — orientación mínima).
const ALWAYS_VISIBLE_ROUTES = ['/', '/support'];

/**
 * Bloquea acceso directo (por URL) a páginas que requieren un tier mayor al
 * actual, o cuyo dominio (etiqueta de PAGE_ROLE_TAGS) no está entre los
 * permisos asignados al usuario. Antes esto solo se aplicaba como filtro de
 * navegación en Sidebar.tsx — un usuario con tier suficiente pero sin el
 * permiso de dominio podía igual acceder a la página por URL directa.
 * En modo demo, el tier viene del demoSession (Essential/Pro/Business/Enterprise).
 * SUPERADMIN bypassa siempre.
 */
export default function RouteTierGate({ children }: { children: React.ReactNode }) {
    const pathname = usePathname() || '/';
    const { selectedTenant, systemRole, userRole, userPermissions } = useTenant();

    const requiredTier = getRequiredTierForPath(pathname);
    const currentTier = (selectedTenant as any)?.tier || 'Essential';

    if (systemRole === 'SUPERADMIN') return <>{children}</>;

    if (requiredTier && !hasAccess(currentTier, requiredTier)) {
        return <TierBlocked requiredTier={requiredTier} currentTier={currentTier} />;
    }

    // Permisos de dominio: mismo criterio "opt-in" que Sidebar.tsx — solo se
    // aplica si el usuario tiene ≥1 permiso asignado y su rol no es Admin/Owner.
    const restrictByPermissions = userPermissions.length > 0 && userRole !== 'Admin' && userRole !== 'Owner';
    if (restrictByPermissions && !ALWAYS_VISIBLE_ROUTES.includes(stripLocale(pathname))) {
        const pageTags = getTagsForRoute(pathname);
        if (!hasAnyTag(userPermissions, pageTags)) {
            return <PermissionBlocked pageTags={pageTags} />;
        }
    }

    return <>{children}</>;
}

function TierBlocked({ requiredTier, currentTier }: { requiredTier: string; currentTier: string }) {
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

function PermissionBlocked({ pageTags }: { pageTags: import('@/lib/pageRoleTags').RoleTag[] }) {
    const labels = pageTags.map(t => ROLE_TAG_META[t]?.label || t).join(', ');
    return (
        <div className="content animate-in fade-in">
            <div className="max-w-2xl mx-auto mt-10 bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/40 rounded-2xl p-8 shadow-sm">
                <div className="flex items-start gap-4">
                    <div className="p-3 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400">
                        <ShieldOff className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1">
                            No tenés permiso para ver esta página
                        </h2>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
                            Esta página pertenece al dominio <b>{labels}</b>, y tu usuario no tiene ese permiso asignado.
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-500">
                            Pedile a un Administrador que te asigne el permiso correspondiente en Usuarios y Permisos.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
