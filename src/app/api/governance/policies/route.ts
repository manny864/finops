import { NextRequest, NextResponse } from 'next/server';
import { requireTenantAccess, requireTenantRole } from '@/lib/requestAuth';
import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";
import pool from '@/modules/storage/db';
import { errorMessage, errorStatus } from '@/lib/apiErrors';
import { parseAllowedValues } from '@/lib/tagValueNormalizer';

export const dynamic = 'force-dynamic';

// Las políticas definen el cumplimiento que calcula Tag Governance: escribirlas
// pide Admin/Owner del tenant (o SuperAdmin), como aplicar etiquetas.
const ROLES_ESCRITURA = ['Admin', 'Owner'];

/** `allowedValues`: ausente/null (valor libre) o arreglo de hasta 100 strings no vacíos de hasta 256 caracteres. */
function allowedValuesValidos(v: unknown): boolean {
    if (v === undefined || v === null) return true;
    return Array.isArray(v) && v.length <= 100
        && v.every((x) => typeof x === 'string' && x.trim().length > 0 && x.length <= 256);
}

function allowedValuesParaGuardar(v: unknown): string | null {
    const lista = parseAllowedValues(v);
    return lista ? JSON.stringify(lista) : null;
}

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.headers.get('x-tenant-id') || new URL(request.url).searchParams.get('tenantId') || '';
        await requireTenantAccess(request, tenantId);

        // Tenant demo: se sirve el payload de ejemplo en vez de consultar
        // Azure/DB, que para el tenant de demostración no tienen datos.
        if (isMockTenant(tenantId)) {
            return NextResponse.json(getMockDataForRoute("governance-policies", tenantId));
        }


        const [rows] = await pool.query(
            `SELECT id, policy_name AS policyName, is_required AS isRequired, allowed_values AS allowedValues,
                    created_at AS createdAt, updated_at AS updatedAt
               FROM TaggingPolicies WHERE tenant_id = ?`,
            [tenantId]
        );
        const policies = ((rows as Array<Record<string, unknown>>) || []).map((p) => ({
            ...p,
            allowedValues: parseAllowedValues(p.allowedValues),
        }));

        return NextResponse.json({
            success: true,
            data: policies,
        });
    } catch (error) {
        console.error('Tag Policies GET Error:', error);
        if (errorStatus(error)) {
            return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ error: 'Error fetching policies' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const tenantId = request.headers.get('x-tenant-id') || '';
        await requireTenantRole(request, tenantId, ROLES_ESCRITURA);

        const { policyName, isRequired, allowedValues } = await request.json();

        if (!policyName || typeof isRequired !== 'boolean' || !allowedValuesValidos(allowedValues)) {
            return NextResponse.json(
                { error: 'Missing or invalid fields: policyName, isRequired, allowedValues' },
                { status: 400 }
            );
        }

        // Check if policy already exists
        const [existing] = await pool.query(
            `SELECT id FROM TaggingPolicies WHERE tenant_id = ? AND policy_name = ?`,
            [tenantId, policyName]
        );

        if (existing && (existing as any[]).length > 0) {
            return NextResponse.json(
                { error: 'Policy already exists' },
                { status: 409 }
            );
        }

        await pool.query(
            `INSERT INTO TaggingPolicies (tenant_id, policy_name, is_required, allowed_values)
             VALUES (?, ?, ?, ?)`,
            [tenantId, policyName, isRequired ? 1 : 0, allowedValuesParaGuardar(allowedValues)]
        );

        return NextResponse.json({
            success: true,
            message: 'Policy created successfully',
        });
    } catch (error) {
        console.error('Tag Policies POST Error:', error);
        if (errorStatus(error)) {
            return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ error: 'Error creating policy' }, { status: 500 });
    }
}

export async function PUT(request: NextRequest) {
    try {
        const tenantId = request.headers.get('x-tenant-id') || '';
        await requireTenantRole(request, tenantId, ROLES_ESCRITURA);

        const { id, isRequired, allowedValues } = await request.json();

        if (!id || typeof isRequired !== 'boolean' || !allowedValuesValidos(allowedValues)) {
            return NextResponse.json(
                { error: 'Missing or invalid fields: id, isRequired, allowedValues' },
                { status: 400 }
            );
        }

        // `allowedValues` ausente no toca la lista; null la borra (valor libre).
        if (allowedValues === undefined) {
            await pool.query(
                `UPDATE TaggingPolicies SET is_required = ? WHERE id = ? AND tenant_id = ?`,
                [isRequired ? 1 : 0, id, tenantId]
            );
        } else {
            await pool.query(
                `UPDATE TaggingPolicies SET is_required = ?, allowed_values = ? WHERE id = ? AND tenant_id = ?`,
                [isRequired ? 1 : 0, allowedValuesParaGuardar(allowedValues), id, tenantId]
            );
        }

        return NextResponse.json({
            success: true,
            message: 'Policy updated successfully',
        });
    } catch (error) {
        console.error('Tag Policies PUT Error:', error);
        if (errorStatus(error)) {
            return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ error: 'Error updating policy' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const tenantId = request.headers.get('x-tenant-id') || '';
        await requireTenantRole(request, tenantId, ROLES_ESCRITURA);

        const { id } = await request.json();

        if (!id) {
            return NextResponse.json(
                { error: 'Missing field: id' },
                { status: 400 }
            );
        }

        await pool.query(
            `DELETE FROM TaggingPolicies WHERE id = ? AND tenant_id = ?`,
            [id, tenantId]
        );

        return NextResponse.json({
            success: true,
            message: 'Policy deleted successfully',
        });
    } catch (error) {
        console.error('Tag Policies DELETE Error:', error);
        if (errorStatus(error)) {
            return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        }
        return NextResponse.json({ error: 'Error deleting policy' }, { status: 500 });
    }
}
