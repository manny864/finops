import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { getAzureCredential, listTenantSubscriptions } from '@/lib/azure';
import { getTenantCredentials } from '@/lib/secrets/tenantCredentials';
import { AuthError, requireRequestIdentity, requireTenantAccess } from '@/lib/requestAuth';
import { RowDataPacket } from 'mysql2';
import { getCustomRoleActionsForTier, CUSTOM_REMEDIATION_ROLE_NAME } from '@/lib/onboardingScriptTemplate';
import { errorMessage } from '@/lib/apiErrors';
import { isMockTenant, MOCK_AZURE_SUBSCRIPTIONS } from '@/lib/mockData';

// IDs canónicos de roles built-in de Azure (no cambian).
const BUILTIN_ROLE_IDS: Record<string, string> = {
    'Reader': 'acdd72a7-3385-48ef-bd42-f606fba81ae7',
    'Cost Management Reader': '72fafb9e-0641-4937-9268-a91bfd8191a3',
    'Monitoring Reader': '43d0d8ad-25c7-4714-9337-8ba259a9fe05',
    'Billing Reader': 'fa23ad8b-c56e-40d8-ac0c-ce449e1d2c64',
    'Security Reader': '39bc4728-0917-49c7-9d2c-d95423bc2eb4',
    'Tag Contributor': '4a9ae827-6dc8-4573-8ac7-8239d42aa03f',
    'Contributor': 'b24988ac-6180-42a0-ab88-20f7382dd24c',
    'Owner': '8e3af657-a8ff-443c-a75c-2fe8c4bcb635',
};

// Rol built-in para lectura de reservas (RIs). Se asigna a nivel TENANT
// (/providers/Microsoft.Capacity), NO por suscripción, porque las reservas
// viven a nivel directorio e incluyen scope Shared y Single.
const RESERVATIONS_READER_ROLE_ID = '582fc458-8989-419f-a480-75249bc5db7e';
const RESERVATIONS_SCOPE = '/providers/Microsoft.Capacity';

// Rol de costos a nivel MANAGEMENT GROUP raíz. No es lo mismo que tenerlo por
// suscripción: con este scope el costo de TODAS las suscripciones sale en UNA
// consulta a Cost Management. Sin él, la plataforma degrada a una consulta por
// suscripción y Azure devuelve 429 (Too many requests) — es la causa raíz del
// incidente del 2026-09-16, donde además cada ciclo reintentaba 4 veces contra
// el MG antes de caer al fallback.
const COST_MANAGEMENT_READER_ROLE_ID = BUILTIN_ROLE_IDS['Cost Management Reader'];
const managementGroupScope = (tenantId: string) =>
    `/providers/Microsoft.Management/managementGroups/${tenantId}`;

type RolesByTier = {
    builtIn: string[];
    requireCustomRole: boolean;
    customActions: string[];
};

function getRequiredRoles(tier: string): RolesByTier {
    const baseBuiltIn = ['Reader', 'Cost Management Reader', 'Monitoring Reader', 'Billing Reader', 'Security Reader'];
    const customActions = getCustomRoleActionsForTier(tier);

    switch ((tier || 'Professional').toLowerCase()) {
        case 'business':
            return { builtIn: [...baseBuiltIn, 'Tag Contributor'], requireCustomRole: true, customActions };
        case 'enterprise':
            return { builtIn: [...baseBuiltIn, 'Tag Contributor'], requireCustomRole: true, customActions };
        case 'professional':
        default:
            return { builtIn: baseBuiltIn, requireCustomRole: false, customActions };
    }
}

type SubReport = {
    subscriptionId: string;
    displayName?: string;
    state?: string;
    assignedRoles: string[];
    missingRoles: string[];
    // Verificación del custom role por PERMISOS (no por nombre):
    customRoleRequired: boolean;
    customRoleName?: string | null;   // nombre real del custom role hallado con las acciones requeridas
    missingActions?: string[];        // acciones requeridas que NINGÚN rol asignado otorga
    hasCustomRole?: boolean;          // true si todas las acciones requeridas están cubiertas
    status: 'OK' | 'PARTIAL' | 'NO_ROLES' | 'ERROR';
    error?: string;
};

// Definición resuelta de un rol (para inspeccionar sus acciones).
type ResolvedRoleDef = {
    name: string;
    actions: string[];
    notActions: string[];
    roleType: string; // 'BuiltInRole' | 'CustomRole'
};

// Convierte un patrón de acción de Azure (con wildcards) a RegExp.
// Ej: 'Microsoft.Consumption/*' cubre 'Microsoft.Consumption/budgets/write'; '*' cubre todo.
function actionPatternToRegex(pattern: string): RegExp {
    const escaped = pattern
        .split('*')
        .map(seg => seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
    return new RegExp(`^${escaped}$`, 'i');
}

function isActionGranted(action: string, actions: string[], notActions: string[]): boolean {
    const granted = actions.some(p => actionPatternToRegex(p).test(action));
    if (!granted) return false;
    const denied = notActions.some(p => actionPatternToRegex(p).test(action));
    return !denied;
}

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

// Verifica si el SP tiene 'Reservations Reader' a nivel tenant (Microsoft.Capacity).
// Necesario para el panel "Descuentos por Compromiso (RIs)". Es un scope distinto al
// de suscripción, por eso se consulta por separado. Best-effort: si no se puede
// listar asignaciones en ese scope, se reporta 'UNKNOWN' en lugar de romper.
type ReservationsAccess = {
    assigned: boolean;
    status: 'OK' | 'MISSING' | 'UNKNOWN';
    hint: string;
};

async function checkReservationsAccess(armToken: string, spObjectId: string): Promise<ReservationsAccess> {
    try {
        const url = `https://management.azure.com${RESERVATIONS_SCOPE}/providers/Microsoft.Authorization/roleAssignments?$filter=principalId eq '${spObjectId}'&api-version=2022-04-01`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${armToken}` } });
        if (!res.ok) {
            return {
                assigned: false,
                status: 'UNKNOWN',
                hint: `No se pudo verificar el rol de reservas (HTTP ${res.status}). Requiere poder leer asignaciones en ${RESERVATIONS_SCOPE}.`,
            };
        }
        const data = await res.json();
        const assigned = (data.value || []).some(
            (a: any) => (a.properties?.roleDefinitionId?.split('/').pop() || '').toLowerCase() === RESERVATIONS_READER_ROLE_ID
        );
        return assigned
            ? { assigned: true, status: 'OK', hint: `✅ 'Reservations Reader' asignado en ${RESERVATIONS_SCOPE}. Las reservas (RIs) Shared/Single se listarán en el panel.` }
            : { assigned: false, status: 'MISSING', hint: `⚠️ Falta 'Reservations Reader' en ${RESERVATIONS_SCOPE}. Un Reservations Administrator debe asignarlo al SP (Portal > Reservations > Access control) o re-ejecutar el script de onboarding. Sin él, las reservas no aparecen.` };
    } catch (e) {
        return {
            assigned: false,
            status: 'UNKNOWN',
            hint: `No se pudo verificar el rol de reservas: ${(errorMessage(e) || String(e)).slice(0, 160)}`,
        };
    }
}

// Chequeo del scope MANAGEMENT GROUP raíz. Mismo patrón best-effort que
// checkReservationsAccess: si no se pueden leer las asignaciones, 'UNKNOWN' en
// vez de romper el reporte entero.
//
// Ojo con el 403: acá es INFORMACIÓN, no un fallo del chequeo. Si el SP no
// puede ni leer las asignaciones del MG es porque no tiene rol ahí, que es
// justamente lo que se está buscando. Por eso se reporta MISSING y no UNKNOWN.
async function checkManagementGroupCostAccess(
    armToken: string,
    spObjectId: string,
    tenantId: string
): Promise<ReservationsAccess> {
    const scope = managementGroupScope(tenantId);
    const faltaHint = `⚠️ Falta 'Cost Management Reader' en el management group raíz (${scope}). Un Owner o User Access Administrator del MG debe asignarlo al SP, o re-ejecutar el script de onboarding con una cuenta que tenga ese permiso. Sin él, el costo se consulta suscripción por suscripción y Azure responde 429 (Too many requests): los paneles de costo histórico y proyección quedan degradados.`;
    try {
        const url = `https://management.azure.com${scope}/providers/Microsoft.Authorization/roleAssignments?$filter=principalId eq '${spObjectId}'&api-version=2022-04-01`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${armToken}` } });
        if (res.status === 403 || res.status === 401) {
            return { assigned: false, status: 'MISSING', hint: faltaHint };
        }
        if (!res.ok) {
            return {
                assigned: false,
                status: 'UNKNOWN',
                hint: `No se pudo verificar el rol de costos en el management group (HTTP ${res.status}). Requiere poder leer asignaciones en ${scope}.`,
            };
        }
        const data = await res.json();
        const assigned = (data.value || []).some(
            (a: any) => (a.properties?.roleDefinitionId?.split('/').pop() || '').toLowerCase() === COST_MANAGEMENT_READER_ROLE_ID
        );
        return assigned
            ? { assigned: true, status: 'OK', hint: `✅ 'Cost Management Reader' asignado en ${scope}. El costo de todas las suscripciones se consulta en una sola llamada.` }
            : { assigned: false, status: 'MISSING', hint: faltaHint };
    } catch (e) {
        return {
            assigned: false,
            status: 'UNKNOWN',
            hint: `No se pudo verificar el rol de costos en el management group: ${(errorMessage(e) || String(e)).slice(0, 160)}`,
        };
    }
}

// Resuelve la definición completa de un rol (nombre + acciones + notActions + tipo).
async function resolveRoleDef(
    armToken: string,
    subscriptionId: string,
    roleDefinitionId: string,
    cache: Map<string, ResolvedRoleDef>
): Promise<ResolvedRoleDef> {
    if (cache.has(roleDefinitionId)) return cache.get(roleDefinitionId)!;

    let def: ResolvedRoleDef = { name: `Unknown (${roleDefinitionId})`, actions: [], notActions: [], roleType: 'Unknown' };
    try {
        const url = `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleDefinitionId}?api-version=2022-04-01`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${armToken}` } });
        if (res.ok) {
            const data = await res.json();
            const perms = data.properties?.permissions || [];
            def = {
                name: data.properties?.roleName || def.name,
                actions: perms.flatMap((p: any) => p.actions || []),
                notActions: perms.flatMap((p: any) => p.notActions || []),
                roleType: data.properties?.type || 'Unknown',
            };
        }
    } catch {
        // fallback al nombre built-in conocido si el fetch falla
        for (const [name, id] of Object.entries(BUILTIN_ROLE_IDS)) {
            if (id === roleDefinitionId) { def = { ...def, name, roleType: 'BuiltInRole' }; break; }
        }
    }
    cache.set(roleDefinitionId, def);
    return def;
}

/**
 * Reporte sintetico de verificacion de permisos para los tenants demo.
 *
 * La prosa (`globalHint`, el hint de reservas) viaja como CLAVE y no como
 * texto: el servidor no conoce el locale del usuario y este payload es la
 * superficie de demo, que tiene que leerse bien en los tres idiomas. Los
 * campos de texto quedan en castellano como fallback, igual que en el resto
 * de la plataforma.
 */
function buildMockSpRolesReport(tenantId: string) {
    const required = getRequiredRoles('Enterprise');
    const spObjectId = 'd0000000-0000-4000-8000-00000000ffff';
    const [subA, subB, subC] = MOCK_AZURE_SUBSCRIPTIONS;

    const completo = (sub: { id: string; name: string }): SubReport => ({
        subscriptionId: sub.id,
        displayName: sub.name,
        state: 'Enabled',
        assignedRoles: [...required.builtIn],
        missingRoles: [],
        customRoleRequired: true,
        customRoleName: CUSTOM_REMEDIATION_ROLE_NAME,
        missingActions: [],
        hasCustomRole: true,
        status: 'OK',
    });

    const incompleto = (sub: { id: string; name: string }): SubReport => ({
        subscriptionId: sub.id,
        displayName: sub.name,
        state: 'Enabled',
        assignedRoles: required.builtIn.filter((r) => r !== 'Tag Contributor'),
        missingRoles: ['Tag Contributor'],
        customRoleRequired: true,
        customRoleName: null,
        missingActions: required.customActions.slice(0, 2),
        hasCustomRole: false,
        status: 'PARTIAL',
    });

    const subscriptions = [completo(subA), completo(subB), incompleto(subC)];

    return {
        success: true,
        mock: true,
        summary: {
            tenantId,
            tier: 'Enterprise',
            clientId: 'd0000000-0000-4000-8000-00000000aaaa',
            spObjectId,
            requiredRoles: required.builtIn,
            requiredCustomRole: CUSTOM_REMEDIATION_ROLE_NAME,
            requiredCustomActions: required.customActions,
            totalSubscriptions: subscriptions.length,
            okCount: subscriptions.filter((r) => r.status === 'OK').length,
            partialCount: subscriptions.filter((r) => r.status === 'PARTIAL').length,
            noRolesCount: 0,
            errorCount: 0,
            reservationsAccess: {
                status: 'OK',
                hint: 'El SP puede leer las reservas del directorio.',
                hintKey: 'reservationsOkDemo',
            },
            managementGroupCostAccess: {
                status: 'OK',
                hint: 'El SP puede consultar el costo agregado del management group raíz.',
                hintKey: 'managementGroupCostOkDemo',
            },
        },
        subscriptions,
        globalHint: '1 suscripcion con roles/permisos incompletos.',
        globalHintKey: 'globalHintPartialDemo',
        globalHintParams: { count: 1, roles: 'Tag Contributor', sp: spObjectId },
        timestamp: new Date().toISOString(),
    };
}

export async function GET(request: NextRequest) {
    try {
        const identity = await requireRequestIdentity(request);
        const tenantId = request.nextUrl.searchParams.get('tenantId') || identity.tenantId;

        // isMockTenant ANTES del guard. Sin esto la verificacion en demo moria en
        // TENANT_NOT_FOUND: los tenants sinteticos no tienen fila en Tenants, ni
        // client_id, ni un SP contra el que consultar Graph. El reporte de abajo
        // es deliberadamente MIXTO (dos OK y una incompleta): un all-green no
        // demuestra para que sirve la pantalla.
        if (isMockTenant(tenantId)) {
            return NextResponse.json(buildMockSpRolesReport(tenantId));
        }

        await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        const [rows] = await pool.query<RowDataPacket[]>(
            'SELECT tier FROM Tenants WHERE tenant_id = ?',
            [tenantId]
        );
        if (rows.length === 0) {
            return NextResponse.json({
                error: 'TENANT_NOT_FOUND',
                message: `El tenant ${tenantId} no está registrado en la base de datos.`,
                hint: 'Complete el onboarding ejecutando el script PowerShell desde Admin > Onboarding.',
            }, { status: 404 });
        }
        const { tier } = rows[0];
        const creds = await getTenantCredentials(tenantId);
        const clientId = creds?.clientId;
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
                hint: 'Verifique que el App Registration y el Service Principal existan. Re-ejecute el script de onboarding si fue eliminado. También pueden faltar permisos Graph de aplicación en el SP (Directory.Read.All / Organization.Read.All).',
            }, { status: 404 });
        }

        let allSubs: Array<{ subscriptionId: string; displayName: string; state: string }>;
        try {
            allSubs = (await listTenantSubscriptions(tenantId, credential)).map((s) => ({
                subscriptionId: s.subscriptionId,
                displayName: String(s.displayName || s.subscriptionId),
                state: String(s.state || ''),
            }));
        } catch (e) {
            return NextResponse.json({
                error: 'CANNOT_LIST_SUBSCRIPTIONS',
                message: `Error al listar suscripciones: ${errorMessage(e)}`,
                hint: 'El Service Principal no tiene permisos para listar suscripciones.',
            }, { status: 500 });
        }

        const subFilter = request.nextUrl.searchParams.get('subscriptionIds');
        const filtered = subFilter
            ? allSubs.filter(s => subFilter.split(',').map(x => x.trim()).includes(s.subscriptionId))
            : allSubs;

        const roleDefCache = new Map<string, ResolvedRoleDef>();
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
                const defs = await Promise.all(
                    assignments.map(a => resolveRoleDef(armToken, sub.subscriptionId, a.roleDefinitionId, roleDefCache))
                );
                report.assignedRoles = Array.from(new Set(defs.map(d => d.name))).sort();

                const missingBuiltIn = required.builtIn.filter(r => !report.assignedRoles.includes(r));
                report.missingRoles = missingBuiltIn;

                if (required.requireCustomRole && required.customActions.length > 0) {
                    // Verificación por PERMISOS: cada acción requerida debe ser otorgada
                    // por algún rol asignado (considerando wildcards y notActions).
                    const missingActions = required.customActions.filter(
                        action => !defs.some(d => isActionGranted(action, d.actions, d.notActions))
                    );
                    report.missingActions = missingActions;
                    report.hasCustomRole = missingActions.length === 0;

                    // Nombre real del custom role que aporta las acciones de remediación.
                    // Preferimos el rol custom que otorgue MÁS acciones requeridas.
                    const customDefs = defs
                        .filter(d => d.roleType === 'CustomRole')
                        .map(d => ({
                            name: d.name,
                            granted: required.customActions.filter(a => isActionGranted(a, d.actions, d.notActions)).length,
                        }))
                        .filter(d => d.granted > 0)
                        .sort((a, b) => b.granted - a.granted);
                    report.customRoleName = customDefs[0]?.name || null;

                    if (!report.hasCustomRole) {
                        report.missingRoles.push(
                            report.customRoleName
                                ? `${report.customRoleName} (acciones faltantes)`
                                : `Rol de remediación (${missingActions.length} acción/es faltante/s)`
                        );
                    }
                }

                if (report.assignedRoles.length === 0) report.status = 'NO_ROLES';
                else if (report.missingRoles.length > 0) report.status = 'PARTIAL';
                else report.status = 'OK';
            } catch (e) {
                report.status = 'ERROR';
                report.error = (errorMessage(e) || String(e)).slice(0, 240);
            }

            return report;
        }));

        // Chequeo de acceso a RESERVAS (RIs) a nivel tenant (scope aparte de las suscripciones).
        const reservationsAccess = await checkReservationsAccess(armToken, spObjectId);

        // Chequeo del MANAGEMENT GROUP raíz: sin este rol el costo se consulta
        // suscripción por suscripción y aparecen los 429.
        const managementGroupCostAccess = await checkManagementGroupCostAccess(armToken, spObjectId, tenantId);

        const summary = {
            tenantId,
            tier: tier || 'Professional',
            clientId,
            spObjectId,
            requiredRoles: required.builtIn,
            requiredCustomRole: required.requireCustomRole ? CUSTOM_REMEDIATION_ROLE_NAME : null,
            requiredCustomActions: required.requireCustomRole ? required.customActions : [],
            totalSubscriptions: subReports.length,
            okCount: subReports.filter(r => r.status === 'OK').length,
            partialCount: subReports.filter(r => r.status === 'PARTIAL').length,
            noRolesCount: subReports.filter(r => r.status === 'NO_ROLES').length,
            errorCount: subReports.filter(r => r.status === 'ERROR').length,
            reservationsAccess,
            managementGroupCostAccess,
        };

        let globalHint = '';
        if (summary.okCount === summary.totalSubscriptions && summary.totalSubscriptions > 0) {
            globalHint = `✅ Todas las suscripciones (${summary.totalSubscriptions}) tienen los roles y permisos requeridos para el tier ${summary.tier}.`;
        } else if (summary.noRolesCount > 0) {
            globalHint = `⚠️ El SP no tiene NINGÚN rol en ${summary.noRolesCount} suscripción(es). Re-ejecute el script de onboarding o asigne manualmente los roles requeridos.`;
        } else if (summary.partialCount > 0) {
            const allMissingRoles = Array.from(new Set(subReports.flatMap(r => r.missingRoles)));
            const allMissingActions = Array.from(new Set(subReports.flatMap(r => r.missingActions || [])));
            const actionsHint = allMissingActions.length > 0
                ? ` Acciones del custom role faltantes: ${allMissingActions.join(', ')}. Regenere y re-ejecute el script de onboarding actualizado para actualizar el custom role.`
                : '';
            globalHint = `⚠️ ${summary.partialCount} suscripción(es) con roles/permisos incompletos. Faltantes: ${allMissingRoles.join(', ')}. Asigne al SP (objectId: ${spObjectId}) en las suscripciones afectadas, o re-ejecute el script de onboarding.${actionsHint}`;
        } else if (summary.totalSubscriptions === 0) {
            globalHint = '⚠️ El SP no ve ninguna suscripción. Verifique que tenga al menos rol Reader en alguna suscripción del tenant.';
        }

        // Anexar estado de acceso a reservas (RIs) al hint global.
        if (reservationsAccess.status !== 'OK') {
            globalHint = `${globalHint} ${reservationsAccess.hint}`.trim();
        }

        // Idem para el management group: es el que más impacto tiene en el
        // rendimiento y en los 429, así que también sube al hint global.
        if (managementGroupCostAccess.status !== 'OK') {
            globalHint = `${globalHint} ${managementGroupCostAccess.hint}`.trim();
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
