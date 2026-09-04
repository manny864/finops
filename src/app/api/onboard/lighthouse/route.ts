import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { errorMessage } from '@/lib/apiErrors';
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { getAzureCredential, getSubscriptionsForTenant } from "@/lib/azure";
import {
    LIGHTHOUSE_DELEGATIONS_KQL,
    buildLighthouseSummary,
    mapArgDelegation,
    mapDbDelegation,
    mergeDelegations,
    type RawArgDelegationRow,
    type RawDbDelegationRow,
} from "@/services/azureLighthouse.service";
import type { LighthouseDelegationItem, LighthousePayload } from "@/types/azureLighthouse.types";

/**
 * Delegaciones vivas desde Resource Graph.
 *
 * Devuelve `null` (no un array vacío) cuando ARG no se pudo consultar: la
 * diferencia importa porque "cero delegaciones" y "no pude preguntar" llevan a
 * decisiones distintas, y el segundo caso tiene que caer al registro propio con
 * un aviso, no mostrarse como un inventario vacío.
 */
async function fetchArgDelegations(tenantId: string): Promise<{ items: LighthouseDelegationItem[] } | { error: string }> {
    try {
        const credential = await getAzureCredential(tenantId);
        if (!credential) return { error: "Sin credenciales de Azure para este tenant." };

        // `getSubscriptionsForTenant` devuelve sólo los IDs. El nombre legible de
        // cada suscripción lo trae el propio KQL más abajo cuando existe; si no,
        // la UI muestra el GUID, que es preferible a inventar un nombre.
        const subIds = await getSubscriptionsForTenant(tenantId);
        if (!subIds || subIds.length === 0) return { error: "El Service Principal no alcanza ninguna suscripción." };

        const client = new ResourceGraphClient(credential);
        const res = await client.resources({ subscriptions: subIds, query: LIGHTHOUSE_DELEGATIONS_KQL });
        const rows = (res.data as RawArgDelegationRow[]) || [];
        return { items: rows.map((r) => mapArgDelegation(r)) };
    } catch (e) {
        return { error: errorMessage(e) || "Resource Graph no respondió." };
    }
}

const MOCK_DELEGATIONS = [
    { id: 1, managedTenantId: '00000000-1111-2222-3333-444444444444', managedSubscriptionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', roles: ['Reader', 'Cost Management Reader', 'Tag Contributor'], status: 'active', delegatedAt: '2026-05-15T10:00:00Z' },
    { id: 2, managedTenantId: '11111111-2222-3333-4444-555555555555', managedSubscriptionId: 'ffffffff-1111-2222-3333-444444444444', roles: ['Reader', 'Cost Management Reader'], status: 'pending', delegatedAt: null },
];

const MOCK_GET_RESPONSE = { success: true, mock: true, delegations: MOCK_DELEGATIONS };

/**
 * El principal del lado NUESTRO que recibe el acceso delegado.
 *
 * Tiene que ser el object ID de un grupo de seguridad (o de un service
 * principal) que viva en el tenant que administra, y Microsoft recomienda que
 * sea un GRUPO: los miembros se agregan y se sacan sin volver a desplegar nada
 * en la suscripcion del cliente.
 *
 * No hay valor por defecto a proposito. Ver `buildArmTemplate`.
 */
function principalDelegado(): { id: string; nombre: string } | null {
    const id = process.env.AZURE_LIGHTHOUSE_PRINCIPAL_ID;
    if (!id || !GUID.test(id)) return null;
    return { id, nombre: process.env.AZURE_LIGHTHOUSE_PRINCIPAL_NAME || 'CSCloudSolutions FinOps' };
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Plantilla ARM de delegacion por Azure Lighthouse.
 *
 * EL BUG QUE ESTO ARREGLA (2026-09-04)
 * `principalId` se rellenaba con `00000000-0000-0000-0000-00000000000${i+1}`
 * cuando no venia en el body --y no venia NUNCA, porque ninguno de los dos
 * paneles lo manda--. O sea que todas las plantillas generadas llevaban cuatro
 * GUIDs inventados.
 *
 * Y no fallaba: Lighthouse NO verifica que el principal exista al desplegar. En
 * la suscripcion de un cliente real la plantilla habria entrado en verde, la
 * delegacion figuraria activa de los dos lados, y no le habria dado acceso a
 * nadie. Un no-op que se ve como un exito es peor que un error.
 *
 * Por eso ahora devuelve null en vez de inventar: sin principal configurado no
 * hay plantilla que valga la pena entregar.
 */
function buildArmTemplate(managingTenantId: string, roles: string[]) {
    const roleMap: Record<string, string> = {
        'Reader': 'acdd72a7-3385-48ef-bd42-f606fba81ae7',
        'Cost Management Reader': '72fafb9e-0641-4937-9268-a91bfd8191a3',
        'Tag Contributor': '4a9ae827-6dc8-4573-8ac7-8239d42aa03f',
        'Contributor': 'b24988ac-6180-42a0-ab88-20f7382dd24c',
    };

    const principal = principalDelegado();
    if (!principal) return null;

    // Un principal, varios roles: es como Lighthouse espera las autorizaciones.
    // Se deduplica porque dos roles que mapeen al mismo GUID --p.ej. un nombre
    // desconocido cayendo al default-- generarian una autorizacion repetida, y
    // ARM la rechaza.
    const idsDeRol = Array.from(new Set(roles.map((role) => roleMap[role]).filter(Boolean)));
    const authorizations = idsDeRol.map((roleDefinitionId) => ({
        principalId: principal.id,
        principalIdDisplayName: principal.nombre,
        roleDefinitionId,
    }));

    return {
        $schema: 'https://schema.management.azure.com/schemas/2018-05-01/subscriptionDeploymentTemplate.json#',
        contentVersion: '1.0.0.0',
        parameters: {},
        resources: [{
            type: 'Microsoft.ManagedServices/registrationDefinitions',
            apiVersion: '2020-02-01-preview',
            name: '[guid(subscription().id)]',
            properties: {
                registrationDefinitionName: 'CSCloudSolutions FinOps Delegation',
                description: 'Delegated access for FinOps management via CSCloudSolutions',
                managedByTenantId: managingTenantId,
                authorizations,
            },
        }, {
            type: 'Microsoft.ManagedServices/registrationAssignments',
            apiVersion: '2020-02-01-preview',
            // Deterministico: con `deployment().name` adentro, cada re-despliegue
            // creaba una asignacion NUEVA en vez de actualizar la que ya estaba.
            name: '[guid(subscription().id)]',
            dependsOn: ['[resourceId(\'Microsoft.ManagedServices/registrationDefinitions\', guid(subscription().id))]'],
            properties: {
                registrationDefinitionId: '[resourceId(\'Microsoft.ManagedServices/registrationDefinitions\', guid(subscription().id))]',
            },
        }],
    };
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = new URL(request.url).searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        try {
            await requireTenantRole(request, tenantId, ['Admin', 'Owner']);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        if (isMockTenant(tenantId)) {
            const items = MOCK_DELEGATIONS.map((d) =>
                mapDbDelegation({
                    id: d.id,
                    managed_tenant_id: d.managedTenantId,
                    managed_subscription_id: d.managedSubscriptionId,
                    roles: d.roles,
                    status: d.status,
                    delegated_at: d.delegatedAt,
                })
            );
            const payload: LighthousePayload = {
                summary: buildLighthouseSummary(items),
                source: "mock",
                mock: true,
                lastUpdated: new Date().toISOString(),
            };
            // `delegations` plano se mantiene por el consumidor viejo del dashboard.
            return NextResponse.json({ success: true, ...payload, delegations: MOCK_DELEGATIONS });
        }

        // Registro propio: las plantillas que se emitieron. No prueba que el
        // cliente las haya desplegado, así que es complemento de ARG, no su
        // reemplazo.
        let dbItems: LighthouseDelegationItem[] = [];
        let dbRows: unknown[] = [];
        try {
            const [rows]: any = await pool.query(
                'SELECT * FROM TenantDelegations WHERE tenant_id = ? ORDER BY delegated_at DESC',
                [tenantId]
            );
            dbRows = rows || [];
            dbItems = (rows as RawDbDelegationRow[] || []).map(mapDbDelegation);
        } catch (dbErr) {
            console.error("[lighthouse] GET DB error for real tenant:", tenantId, errorMessage(dbErr));
        }

        const arg = await fetchArgDelegations(tenantId);
        if ("items" in arg) {
            const merged = mergeDelegations(arg.items, dbItems);
            const payload: LighthousePayload = {
                summary: buildLighthouseSummary(merged),
                source: "live",
                lastUpdated: new Date().toISOString(),
            };
            return NextResponse.json({ success: true, ...payload, delegations: dbRows });
        }

        // ARG no respondió: se muestra el registro propio y se dice por qué, en
        // vez de presentar un inventario vacío como si fuera la realidad.
        const payload: LighthousePayload = {
            summary: buildLighthouseSummary(dbItems),
            source: "snapshot",
            warning: `Azure Resource Graph no respondió (${arg.error}); se muestran las delegaciones que emitió la plataforma, sin confirmar contra Azure.`,
            lastUpdated: new Date().toISOString(),
        };
        return NextResponse.json({ success: true, ...payload, delegations: dbRows });
    } catch (err: unknown) {
        console.error("[lighthouse] GET handler error:", err instanceof Error ? err.message : err);
        return NextResponse.json({ success: false, mock: false, delegations: [], error: "Internal server error" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const tenantId = new URL(request.url).searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });

        try {
            await requireTenantRole(request, tenantId, ['Admin', 'Owner']);
        } catch (e) {
            if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
            throw e;
        }

        const body = await request.json();
        const { managedTenantId, managedSubscriptionId, roles } = body;
        if (!managedTenantId || !managedSubscriptionId || !roles) {
            return NextResponse.json({ error: "Faltan campos: managedTenantId, managedSubscriptionId, roles" }, { status: 400 });
        }

        // Lighthouse no puede delegar una suscripcion a su PROPIO tenant: la
        // delegacion existe para que el directorio del cliente le de acceso al
        // nuestro. Azure lo rechaza igual, pero con un
        // `InvalidRegistrationDefinitionCreateRequest` que no explica nada
        // --pasa al probar la plantilla sobre una suscripcion propia--.
        if (String(managedTenantId).toLowerCase() === String(tenantId).toLowerCase()) {
            return NextResponse.json({
                error: "Azure Lighthouse no permite delegar una suscripción al mismo tenant al que ya pertenece. El tenant administrado tiene que ser el del cliente, distinto del nuestro.",
            }, { status: 400 });
        }

        const armTemplate = buildArmTemplate(tenantId, roles);
        if (!armTemplate) {
            // Antes se entregaba una plantilla con principals inventados, que
            // desplegaba sin error y no le daba acceso a nadie.
            return NextResponse.json({
                error: "Falta configurar AZURE_LIGHTHOUSE_PRINCIPAL_ID: es el object ID del grupo de seguridad de nuestro tenant que recibe el acceso delegado. Sin eso la plantilla se despliega bien pero no otorga acceso a nadie.",
            }, { status: 503 });
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, mock: true, id: 99, status: 'pending', armTemplate });
        }

        try {
            const rolesJson = JSON.stringify(Array.isArray(roles) ? roles : [roles]);
            const [result]: any = await pool.query(
                'INSERT INTO TenantDelegations (tenant_id, managed_tenant_id, managed_subscription_id, roles, status, delegated_by, delegated_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
                [tenantId, managedTenantId, managedSubscriptionId, rolesJson, 'pending', tenantId]
            );
            return NextResponse.json({ success: true, mock: false, id: result.insertId, status: 'pending', armTemplate });
        } catch (dbErr) {
            console.error("[lighthouse] POST DB error for real tenant:", tenantId, errorMessage(dbErr));
            return NextResponse.json({ success: false, mock: false, error: `No se pudo persistir la delegación: ${errorMessage(dbErr) || "error"}`, armTemplate }, { status: 500 });
        }
    } catch (error: unknown) {
        console.error("[lighthouse] POST handler error:", error instanceof Error ? error.message : error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
