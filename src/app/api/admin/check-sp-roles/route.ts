import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { getAzureCredential } from '@/lib/azure';
import { AuthError, requireRequestIdentity, requireTenantAccess } from '@/lib/requestAuth';
import { RowDataPacket } from 'mysql2';

// IDs canónicos de roles built-in de Azure (no cambian).
const BUILTIN_ROLE_IDS: Record<string, string> = {
    'Reader': 'acdd72a7-3385-48ef-bd42-f606fba81ae7',
    'Cost Management Reader': '72fafb9e-0641-4937-9268-a91bfd8191a3',
    'Monitoring Reader': '43d0d8ad-25c7-4714-9337-8ba259a9fe05',
    'Billing Reader': 'fa23ad8b-c56e-40d8-ac0c-ce449e1d2c64',
    'Tag Contributor': '4a9ae827-6dc8-4573-8ac7-8239d42aa03f',
    'Contributor': 'b24988ac-6180-42a0-ab88-20f7382dd24c',
    'Owner': '8e3af657-a8ff-443c-a75c-2fe8c4bcb635',
};

const CUSTOM_REMEDIATION_ROLE_NAME = 'CSCloudSolutions Remediation Role';

type RolesByTier = {
    builtIn: string[];
    requireCustomRole: boolean;
};

function getRequiredRoles(tier: string): RolesByTier {
    const essentialBuiltIn = ['Reader', 'Cost Management Reader', 'Monitoring Reader', 'Billing Reader'];

    switch ((tier || 'Essential').toLowerCase()) {
        case 'professional':
            return { builtIn: [...essentialBuiltIn, 'Tag Contributor'], requireCustomRole: false };
        case 'business':
            return { builtIn: [...essentialBuiltIn, 'Tag Contributor'], requireCustomRole: true };
        case 'enterprise':
            return { builtIn: [...essentialBuiltIn, 'Tag Contributor'], requireCustomRole: true };
        case 'essential':
        default:
            return { builtIn: essentialBuiltIn, requireCustomRole: false };
    }
}

type SubReport = {
    subscriptionId: string;
    displayName?: string;
    state?: string;
    assignedRoles: string[];
    missingRoles: string[];
    hasCustomRole?: boolean;
    customRoleRequired: boolean;
    status: 'OK' | 'PARTIAL' | 'NO_ROLES' | 'ERROR';
    error?: string;
};

async function resolveSpObjectId(token: string, clientId: string): Promise<string | null> {
    const url = `https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId eq '${clientId}'&$select=id`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const data = await res.json();
    return data.value?.[0]?.id || null;
}

async function listSpRoleAssignmentsInSubscription(
    armToken: string,
    subscriptionId: string,
    spObjectId: string
): Promise<{ roleDefinitionId: string; principalId: string }[]> {
    const url = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleAssignments?$filter=principalId eq '${spObjectId}'&api-version=2022-04-01`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${armToken}` } });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status} listando role assignments: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    return (data.value || []).map((a: any) => ({
        roleDefinitionId: a.properties?.roleDefinitionId?.split('/').pop() || '',
        principalId: a.properties?.principalId || '',
    }));
}

async function resolveRoleName(
    armToken: string,
    subscriptionId: string,
    roleDefinitionId: string,
    cache: Map<string, string>
): Promise<string> {
    if (cache.has(roleDefinitionId)) return cache.get(roleDefinitionId)!;

    for (const [name, id] of Object.entries(BUILTIN_ROLE_IDS)) {
        if (id === roleDefinitionId) {
            cache.set(roleDefinitionId, name);
            return name;
        }
    }

    try {
        const url = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleDefinitionId}?api-version=2022-04-01`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${armToken}` } });
        if (res.ok) {
            const data = await res.json();
            const name = data.properties?.roleName || `Unknown (${roleDefinitionId})`;
            cache.set(roleDefinitionId, name);
            return name;
        }
    } catch {
        // ignore
    }
    cache.set(roleDefinitionId, `Unknown (${roleDefinitionId})`);
    return cache.get(roleDefinitionId)!;
}

export async function GET(request: NextRequest) {
    try {
        const identity = await requireRequestIdentity(request);
        const tenantId = request.nextUrl.searchParams.get('tenantId') || identity.tenantId;

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        const [rows] = await pool.query<RowDataPacket[]>(
            'SELECT client_id, client_secret, tier FROM Tenants WHERE tenant_id = ?',
            [tenantId]
        );
        if (rows.length === 0) {
            return NextResponse.json({
                error: 'TENANT_NOT_FOUND',
                message: `El tenant ${tenantId} no está registrado en la base de datos.`,
                hint: 'Complete el onboarding ejecutando el script PowerShell desde Admin > Onboarding.',
            }, { status: 404 });
        }
        const { client_id: clientId, tier } = rows[0];
        if (!clientId) {
            return NextResponse.json({
                error: 'NO_CLIENT_ID',
                message: 'El tenant no tiene client_id configurado.',
                hint: 'Vuelva a ejecutar el script de onboarding y pegue las credenciales en Admin > Onboarding.',
            }, { status: 400 });
        }

        const required = getRequiredRoles(tier);

        const credential = await getAzureCredential(tenantId);
        const armToken = (await credential.getToken('https://management.azure.com/.default'))?.token;
        const graphToken = (await credential.getToken('https://graph.microsoft.com/.default'))?.token;
        if (!armToken || !graphToken) {
            return NextResponse.json({
                error: 'TOKEN_ACQUISITION_FAILED',
                message: 'No se pudieron obtener tokens del Service Principal.',
                hint: 'Verifique que client_secret no haya expirado. Si caducó, regenérelo y re-ejecute onboarding.',
            }, { status: 500 });
        }

        const spObjectId = await resolveSpObjectId(graphToken, clientId);
        if (!spObjectId) {
            return NextResponse.json({
                error: 'SP_NOT_FOUND_IN_GRAPH',
                message: `No se encontró Service Principal con appId=${clientId} en el tenant ${tenantId}.`,
                hint: 'Verifique que el App Registration y el Service Principal existan. Re-ejecute el script de onboarding si fue eliminado. También puede faltar el permiso Directory.Read.All en el SP.',
            }, { status: 404 });
        }

        const subsRes = await fetch('https://management.azure.com/subscriptions?api-version=2020-01-01', {
            headers: { Authorization: `Bearer ${armToken}` },
        });
        if (!subsRes.ok) {
            return NextResponse.json({
                error: 'CANNOT_LIST_SUBSCRIPTIONS',
                message: `Error al listar suscripciones: HTTP ${subsRes.status}`,
                hint: 'El Service Principal no tiene permisos para listar suscripciones.',
            }, { status: 500 });
        }
        const subsData = await subsRes.json();
        const allSubs = (subsData.value || []) as Array<{ subscriptionId: string; displayName: string; state: string }>;

        const subFilter = request.nextUrl.searchParams.get('subscriptionIds');
        const filtered = subFilter
            ? allSubs.filter(s => subFilter.split(',').map(x => x.trim()).includes(s.subscriptionId))
            : allSubs;

        const roleNameCache = new Map<string, string>();
        const subReports: SubReport[] = await Promise.all(filtered.map(async (sub) => {
            const report: SubReport = {
                subscriptionId: sub.subscriptionId,
                displayName: sub.displayName,
                state: sub.state,
                assignedRoles: [],
                missingRoles: [],
                customRoleRequired: required.requireCustomRole,
                status: 'OK',
            };

            try {
                const assignments = await listSpRoleAssignmentsInSubscription(armToken, sub.subscriptionId, spObjectId);
                const names = await Promise.all(
                    assignments.map(a => resolveRoleName(armToken, sub.subscriptionId, a.roleDefinitionId, roleNameCache))
                );
                report.assignedRoles = Array.from(new Set(names)).sort();

                const missingBuiltIn = required.builtIn.filter(r => !report.assignedRoles.includes(r));
                report.missingRoles = missingBuiltIn;

                if (required.requireCustomRole) {
                    report.hasCustomRole = report.assignedRoles.some(r => r.includes(CUSTOM_REMEDIATION_ROLE_NAME));
                    if (!report.hasCustomRole) {
                        report.missingRoles.push(CUSTOM_REMEDIATION_ROLE_NAME);
                    }
                }

                if (report.assignedRoles.length === 0) report.status = 'NO_ROLES';
                else if (report.missingRoles.length > 0) report.status = 'PARTIAL';
                else report.status = 'OK';
            } catch (e: any) {
                report.status = 'ERROR';
                report.error = (e.message || String(e)).slice(0, 240);
            }

            return report;
        }));

        const summary = {
            tenantId,
            tier: tier || 'Essential',
            clientId,
            spObjectId,
            requiredRoles: required.builtIn,
            requiredCustomRole: required.requireCustomRole ? CUSTOM_REMEDIATION_ROLE_NAME : null,
            totalSubscriptions: subReports.length,
            okCount: subReports.filter(r => r.status === 'OK').length,
            partialCount: subReports.filter(r => r.status === 'PARTIAL').length,
            noRolesCount: subReports.filter(r => r.status === 'NO_ROLES').length,
            errorCount: subReports.filter(r => r.status === 'ERROR').length,
        };

        let globalHint = '';
        if (summary.okCount === summary.totalSubscriptions && summary.totalSubscriptions > 0) {
            globalHint = `✅ Todas las suscripciones (${summary.totalSubscriptions}) tienen los roles requeridos para el tier ${summary.tier}.`;
        } else if (summary.noRolesCount > 0) {
            globalHint = `⚠️ El SP no tiene NINGÚN rol en ${summary.noRolesCount} suscripción(es). Re-ejecute el script de onboarding o asigne manualmente los roles requeridos.`;
        } else if (summary.partialCount > 0) {
            const allMissingRoles = Array.from(new Set(subReports.flatMap(r => r.missingRoles)));
            globalHint = `⚠️ ${summary.partialCount} suscripción(es) con roles incompletos. Roles faltantes: ${allMissingRoles.join(', ')}. Asigne estos roles al SP (objectId: ${spObjectId}) en las suscripciones afectadas, o re-ejecute el script de onboarding actualizado.`;
        } else if (summary.totalSubscriptions === 0) {
            globalHint = '⚠️ El SP no ve ninguna suscripción. Verifique que tenga al menos rol Reader en alguna suscripción del tenant.';
        }

        return NextResponse.json({
            success: true,
            summary,
            subscriptions: subReports,
            globalHint,
            timestamp: new Date().toISOString(),
        });
    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error('[check-sp-roles] Error:', error);
        return NextResponse.json(
            { error: 'INTERNAL_SERVER_ERROR', message: (error as any)?.message || 'Error inesperado' },
            { status: 500 }
        );
    }
}
