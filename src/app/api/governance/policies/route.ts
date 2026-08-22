import { NextRequest, NextResponse } from 'next/server';
import { requireTenantAccess } from '@/lib/requestAuth';
import pool from '@/modules/storage/db';
import { errorMessage, errorStatus } from '@/lib/apiErrors';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.headers.get('x-tenant-id') || new URL(request.url).searchParams.get('tenantId') || '';
        await requireTenantAccess(request, tenantId);

        const [policies] = await pool.query(
            `SELECT id, policyName, isRequired, createdAt, updatedAt FROM TaggingPolicies WHERE tenantId = ?`,
            [tenantId]
        );

        return NextResponse.json({
            success: true,
            data: policies || [],
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
        await requireTenantAccess(request, tenantId);

        const { policyName, isRequired } = await request.json();

        if (!policyName || typeof isRequired !== 'boolean') {
            return NextResponse.json(
                { error: 'Missing or invalid fields: policyName, isRequired' },
                { status: 400 }
            );
        }

        // Check if policy already exists
        const [existing] = await pool.query(
            `SELECT id FROM TaggingPolicies WHERE tenantId = ? AND policyName = ?`,
            [tenantId, policyName]
        );

        if (existing && (existing as any[]).length > 0) {
            return NextResponse.json(
                { error: 'Policy already exists' },
                { status: 409 }
            );
        }

        await pool.query(
            `INSERT INTO TaggingPolicies (tenantId, policyName, isRequired, createdAt, updatedAt) 
             VALUES (?, ?, ?, NOW(), NOW())`,
            [tenantId, policyName, isRequired ? 1 : 0]
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
        await requireTenantAccess(request, tenantId);

        const { id, isRequired } = await request.json();

        if (!id || typeof isRequired !== 'boolean') {
            return NextResponse.json(
                { error: 'Missing or invalid fields: id, isRequired' },
                { status: 400 }
            );
        }

        await pool.query(
            `UPDATE TaggingPolicies SET isRequired = ?, updatedAt = NOW() WHERE id = ? AND tenantId = ?`,
            [isRequired ? 1 : 0, id, tenantId]
        );

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
        await requireTenantAccess(request, tenantId);

        const { id } = await request.json();

        if (!id) {
            return NextResponse.json(
                { error: 'Missing field: id' },
                { status: 400 }
            );
        }

        await pool.query(
            `DELETE FROM TaggingPolicies WHERE id = ? AND tenantId = ?`,
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
