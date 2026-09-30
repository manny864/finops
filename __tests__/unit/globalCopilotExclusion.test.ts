import { describe, it, expect } from 'vitest';
import { isMockTenant } from '@/lib/mockData';

/**
 * Reglas de exclusión de rutas para FinOps Copilot (GlobalCopilot.tsx).
 */
export function isRouteExcludedForCopilot(pathname: string | null | undefined): boolean {
    const isLegalRoute = /^\/(?:[a-zA-Z]{2}(?:-[a-zA-Z]{2,4})?\/)?legal(?:\/|$)/.test(pathname || '');
    const isPublicOrPreAuthRoute = /^\/(?:[a-zA-Z]{2}(?:-[a-zA-Z]{2,4})?\/)?(status|partner|demo|login|signup|verify-email|reset-password|accept-invite)(?:\/|$)/.test(pathname || '');
    return isLegalRoute || isPublicOrPreAuthRoute;
}

/**
 * Validador estricto de sesión para FinOps Copilot (GlobalCopilot.tsx).
 */
export function hasValidatedCopilotSession({
    isMsalAuthenticated,
    accountsCount,
    isDemoMode,
    tenantId,
}: {
    isMsalAuthenticated: boolean;
    accountsCount: number;
    isDemoMode?: boolean;
    tenantId?: string;
}): boolean {
    const isDemoTenant = isMockTenant(tenantId || '');
    return (isMsalAuthenticated && accountsCount > 0) || (!!isDemoMode && isDemoTenant);
}

describe('Exclusión de FinOps Copilot en Páginas Legales y Rutas Públicas', () => {
    describe('Rutas Legales (Deben ser excluidas siempre)', () => {
        const legalRoutes = [
            '/legal',
            '/legal/',
            '/legal/terms',
            '/legal/privacy',
            '/legal/dpa',
            '/legal/security',
            '/legal/subprocessors',
            '/es/legal',
            '/es/legal/terms',
            '/es/legal/privacy',
            '/es/legal/dpa',
            '/es/legal/security',
            '/es/legal/subprocessors',
            '/en/legal',
            '/en/legal/terms',
            '/en/legal/privacy',
            '/pt-BR/legal',
            '/pt-BR/legal/terms',
            '/pt-BR/legal/privacy',
        ];

        legalRoutes.forEach((route) => {
            it(`excluye Copilot en la ruta legal: ${route}`, () => {
                expect(isRouteExcludedForCopilot(route)).toBe(true);
            });
        });
    });

    describe('Rutas Públicas / Pre-autenticación (Deben ser excluidas)', () => {
        const publicRoutes = [
            '/demo',
            '/es/demo',
            '/en/demo',
            '/status',
            '/es/status',
            '/partner',
            '/es/partner',
            '/login',
            '/es/login',
            '/signup',
            '/es/signup',
            '/verify-email',
            '/reset-password',
            '/accept-invite',
        ];

        publicRoutes.forEach((route) => {
            it(`excluye Copilot en la ruta pública: ${route}`, () => {
                expect(isRouteExcludedForCopilot(route)).toBe(true);
            });
        });
    });

    describe('Rutas de la Plataforma SaaS (No deben ser excluidas)', () => {
        const saasRoutes = [
            '/',
            '/overview',
            '/es/overview',
            '/intelligence/billing',
            '/es/intelligence/billing',
            '/intelligence/analitica-avanzada',
            '/cleanup/zombies',
            '/governance/alerts',
            '/admin/config',
        ];

        saasRoutes.forEach((route) => {
            it(`permite Copilot en la ruta de trabajo del SaaS: ${route}`, () => {
                expect(isRouteExcludedForCopilot(route)).toBe(false);
            });
        });
    });

    describe('Validación Estricta de Sesión (Prevenir Copilot a usuarios anónimos con mock tenant residual)', () => {
        it('rechaza a un usuario anónimo sin MSAL ni sesión demo, incluso si tiene un tenant mock residual', () => {
            const hasSession = hasValidatedCopilotSession({
                isMsalAuthenticated: false,
                accountsCount: 0,
                isDemoMode: false,
                tenantId: '22222222-3333-4444-5555-666666666666', // mock tenant de un test previo
            });
            expect(hasSession).toBe(false);
        });

        it('rechaza a un usuario anónimo sin tenant', () => {
            const hasSession = hasValidatedCopilotSession({
                isMsalAuthenticated: false,
                accountsCount: 0,
                isDemoMode: false,
                tenantId: 'default',
            });
            expect(hasSession).toBe(false);
        });

        it('acepta a un usuario con sesión demo legítima y activa', () => {
            const hasSession = hasValidatedCopilotSession({
                isMsalAuthenticated: false,
                accountsCount: 0,
                isDemoMode: true,
                tenantId: '22222222-3333-4444-5555-666666666666',
            });
            expect(hasSession).toBe(true);
        });

        it('acepta a un usuario real con cuenta MSAL autenticada', () => {
            const hasSession = hasValidatedCopilotSession({
                isMsalAuthenticated: true,
                accountsCount: 1,
                isDemoMode: false,
                tenantId: 'real-tenant-uuid',
            });
            expect(hasSession).toBe(true);
        });

        it('rechaza a un usuario si MSAL está en progreso sin cuentas válidas', () => {
            const hasSession = hasValidatedCopilotSession({
                isMsalAuthenticated: false,
                accountsCount: 0,
                isDemoMode: false,
                tenantId: 'real-tenant-uuid',
            });
            expect(hasSession).toBe(false);
        });
    });
});
