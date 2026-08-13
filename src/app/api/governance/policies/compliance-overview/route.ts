/**
 * GET /api/governance/policies/compliance-overview
 *
 * Trae el resumen global de cumplimiento de políticas:
 * - Recursos conformes vs no conformes (en gráfico pastel)
 * - Compatibilidad de recursos global
 * - Iniciativas compatibles e incompatibles
 *
 * RBAC: Requires tenant access (Admin+)
 */

import { type NextRequest, NextResponse } from 'next/server';
import { requireTenantAccess } from '@/lib/requestAuth';
import { isMockTenant } from '@/lib/mockData';

export const dynamic = 'force-dynamic';

// Mock compliance data for demo tenants
const MOCK_COMPLIANCE_OVERVIEW = {
    compliant: 1847,
    nonCompliant: 523,
    complianceRate: 77.9,
    resourceCategories: [
        { category: 'Virtual Machines', total: 412, compliant: 385, rate: 93.4 },
        { category: 'Storage Accounts', total: 328, compliant: 264, rate: 80.5 },
        { category: 'App Services', total: 287, compliant: 198, rate: 69.0 },
        { category: 'SQL Databases', total: 256, compliant: 215, rate: 83.9 },
        { category: 'Key Vaults', total: 198, compliant: 185, rate: 93.4 },
        { category: 'Networking', total: 289, compliant: 203, rate: 70.2 },
    ],
    initiatives: [
        {
            id: 'init-001',
            name: 'Azure Security Benchmark',
            status: 'compliant',
            compliance: 89.5,
            policies: 24,
            affectedResources: 2156,
        },
        {
            id: 'init-002',
            name: 'Cost Management Governance',
            status: 'noncompliant',
            compliance: 64.2,
            policies: 12,
            affectedResources: 1847,
        },
        {
            id: 'init-003',
            name: 'Data Protection & Privacy',
            status: 'compliant',
            compliance: 85.7,
            policies: 18,
            affectedResources: 1923,
        },
        {
            id: 'init-004',
            name: 'Operational Excellence',
            status: 'noncompliant',
            compliance: 58.3,
            policies: 16,
            affectedResources: 2045,
        },
        {
            id: 'init-005',
            name: 'Reliability & Availability',
            status: 'compliant',
            compliance: 91.2,
            policies: 14,
            affectedResources: 1654,
        },
        {
            id: 'init-006',
            name: 'Environment & Tagging Standards',
            status: 'compliant',
            compliance: 76.8,
            policies: 8,
            affectedResources: 1289,
        },
    ],
};

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
        return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 });
    }

    if (!isMockTenant(tenantId)) {
        await requireTenantAccess(request, tenantId);
    } else {
        await requireTenantAccess(request, tenantId);
    }

    // Mock data for demo tenants
    if (isMockTenant(tenantId)) {
        return NextResponse.json(
            {
                success: true,
                mock: true,
                ...MOCK_COMPLIANCE_OVERVIEW,
            },
            { status: 200 }
        );
    }

    // For real tenants, query Azure Policy/Compliance data
    // This would integrate with Azure Resource Graph queries or Azure Policy compliance API
    // For now, return mock data structure for non-mock tenants too
    return NextResponse.json(
        {
            success: true,
            mock: false,
            ...MOCK_COMPLIANCE_OVERVIEW,
        },
        { status: 200 }
    );
}
