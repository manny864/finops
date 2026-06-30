import { NextRequest, NextResponse } from "next/server";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";

const MOCK_DELEGATIONS = [
    { id: 1, managedTenantId: '00000000-1111-2222-3333-444444444444', managedSubscriptionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', roles: ['Reader', 'Cost Management Reader', 'Tag Contributor'], status: 'active', delegatedAt: '2026-05-15T10:00:00Z' },
    { id: 2, managedTenantId: '11111111-2222-3333-4444-555555555555', managedSubscriptionId: 'ffffffff-1111-2222-3333-444444444444', roles: ['Reader', 'Cost Management Reader'], status: 'pending', delegatedAt: null },
];

const MOCK_GET_RESPONSE = { success: true, mock: true, delegations: MOCK_DELEGATIONS };

function buildArmTemplate(managingTenantId: string, principalId: string, roles: string[]) {
    const roleMap: Record<string, string> = {
        'Reader': 'acdd72a7-3385-48ef-bd42-f606fba81ae7',
        'Cost Management Reader': '72fafb9e-0641-4937-9268-a91bfd8191a3',
        'Tag Contributor': '4a9ae827-6dc8-4573-8ac7-8239d42aa03f',
        'Contributor': 'b24988ac-6180-42a0-ab88-20f7382dd24c',
    };

    const authorizations = roles.map((role, i) => ({
        principalId: principalId || `00000000-0000-0000-0000-00000000000${i + 1}`,
        roleDefinitionId: roleMap[role] || 'acdd72a7-3385-48ef-bd42-f606fba81ae7',
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
                registrationDefinitionName: 'CSCloud FinOps Delegation',
                description: 'Delegated access for FinOps management via CSCloudSolutions',
                managedByTenantId: managingTenantId,
                authorizations,
            },
        }, {
            type: 'Microsoft.ManagedServices/registrationAssignments',
            apiVersion: '2020-02-01-preview',
            name: '[guid(subscription().id, deployment().name)]',
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

        if (isMockTenant(tenantId)) return NextResponse.json(MOCK_GET_RESPONSE);

        try {
            const [rows]: any = await pool.query(
                'SELECT * FROM TenantDelegations WHERE tenant_id = ? ORDER BY delegated_at DESC',
                [tenantId]
            );
            return NextResponse.json({ success: true, mock: false, delegations: rows || [] });
        } catch (dbErr: any) {
            console.error("[lighthouse] GET DB error for real tenant:", tenantId, dbErr?.message);
            return NextResponse.json({ success: false, mock: false, delegations: [], error: `Sin datos: ${dbErr?.message || "error"}` });
        }
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
        const { managedTenantId, managedSubscriptionId, roles, principalId } = body;
        if (!managedTenantId || !managedSubscriptionId || !roles) {
            return NextResponse.json({ error: "Faltan campos: managedTenantId, managedSubscriptionId, roles" }, { status: 400 });
        }

        const armTemplate = buildArmTemplate(tenantId, principalId || '', roles);

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
        } catch (dbErr: any) {
            console.error("[lighthouse] POST DB error for real tenant:", tenantId, dbErr?.message);
            return NextResponse.json({ success: false, mock: false, error: `No se pudo persistir la delegación: ${dbErr?.message || "error"}`, armTemplate }, { status: 500 });
        }
    } catch (error: unknown) {
        console.error("[lighthouse] POST handler error:", error instanceof Error ? error.message : error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
