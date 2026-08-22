/**
 * Estado de Cuenta (Cuentas Cloud — Azure): salud real de la conexión.
 *
 * RBAC: `requireTenantAccess` — cualquier miembro del tenant puede ver si la
 * ingesta de su propio entorno está sana.
 *
 * Directiva 24: `isMockTenant` antes del guard y de la DB; la rama mock
 * devuelve exclusivamente literales sintéticos.
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireTenantAccess } from '@/lib/requestAuth';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { initializeDatabase } from '@/modules/storage/db';
import { isMockTenant } from '@/lib/mockData';
import { getAccountStatus } from '@/services/tenantAccountStatus.service';
import { getAzureCredential } from '@/lib/azure';
import { getSubscriptionNameMap, resolveSubscriptionName } from '@/lib/azureSubscriptionNames';
import type { TenantCloudAccountStatus } from '@/types/tenantAccountStatus.types';

function mockStatus(tenantId: string): TenantCloudAccountStatus {
    const now = new Date();
    return {
        tenantId,
        azureTenantGuid: '81ebe027-e6af-4c09-bc73-58c9012c6408',
        organizationDisplayName: 'CSCloudSolutions Azure Patrocinio (Demo)',
        activePlanTier: 'Enterprise',
        ingestionStatus: 'HEALTHY',
        lastSuccessfulSyncAt: new Date(now.getTime() - 12 * 60000).toISOString(),
        ingestedRecordsCount: 128_450,
        totalActiveSubscriptionsCount: 4,
        apiQuotaRemainingPercentage: 94,
        credentialDaysRemaining: 355,
        lastErrorMessage: null,
        mock: true,
        subscriptions: [
            { id: 'sub-1', subscriptionId: '11111111-1111-1111-1111-111111111111', subscriptionName: 'Producción — Core', state: 'Enabled', offerType: 'EnterpriseAgreement', monthlySpendUSD: 18420.55, resourceCount: 412, isIngestionHealthy: true, lastCostDataTimestamp: now.toISOString() },
            { id: 'sub-2', subscriptionId: '22222222-2222-2222-2222-222222222222', subscriptionName: 'Desarrollo y QA', state: 'Enabled', offerType: 'PayAsYouGo', monthlySpendUSD: 4310.10, resourceCount: 168, isIngestionHealthy: true, lastCostDataTimestamp: now.toISOString() },
            { id: 'sub-3', subscriptionId: '33333333-3333-3333-3333-333333333333', subscriptionName: 'Patrocinio FinOps', state: 'Warned', offerType: 'Sponsorship', monthlySpendUSD: 980.00, resourceCount: 54, isIngestionHealthy: false, lastCostDataTimestamp: new Date(now.getTime() - 72 * 36e5).toISOString() },
            { id: 'sub-4', subscriptionId: '44444444-4444-4444-4444-444444444444', subscriptionName: 'Clientes CSP', state: 'Enabled', offerType: 'CSP', monthlySpendUSD: 7655.90, resourceCount: 233, isIngestionHealthy: true, lastCostDataTimestamp: now.toISOString() },
        ],
    };
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.nextUrl.searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true, status: mockStatus(tenantId) });
        }

        await initializeDatabase();
        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        const status = await getAccountStatus(tenantId);
        if (!status) return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });

        // Los nombres legibles de suscripción exigen credencial de Azure. Si no
        // se pueden resolver se deja el GUID: mostrar un nombre inventado sería
        // peor que mostrar el identificador real.
        try {
            const credential = await getAzureCredential(tenantId);
            if (credential) {
                const nameMap = await getSubscriptionNameMap(tenantId, credential);
                status.subscriptions = status.subscriptions.map((s) => ({
                    ...s,
                    subscriptionName: resolveSubscriptionName(s.subscriptionId, nameMap),
                }));
            }
        } catch (nameErr) {
            console.warn('[account-status] no se pudieron resolver nombres de suscripción:', errorMessage(nameErr));
        }

        return NextResponse.json({ success: true, status });
    } catch (e) {
        if (e instanceof AuthError) return NextResponse.json({ error: errorMessage(e) }, { status: errorStatus(e) });
        console.error('[/api/admin/config/account-status] GET error:', e);
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}
