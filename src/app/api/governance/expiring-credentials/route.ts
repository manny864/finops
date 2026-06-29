import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";

const MOCK_ITEMS = [
    { appId: 'aaaaaaaa-0000-0000-0000-000000000001', displayName: 'finops-onboarding-sp', credentialType: 'password', credentialId: 'kid-001', expiresAt: '2026-07-03T00:00:00Z', daysTillExpiry: 5, severity: 'critical' },
    { appId: 'bbbbbbbb-0000-0000-0000-000000000002', displayName: 'github-actions-cicd', credentialType: 'certificate', credentialId: 'kid-002', expiresAt: '2026-07-18T00:00:00Z', daysTillExpiry: 20, severity: 'high' },
    { appId: 'cccccccc-0000-0000-0000-000000000003', displayName: 'data-ingest-job', credentialType: 'password', credentialId: 'kid-003', expiresAt: '2026-08-10T00:00:00Z', daysTillExpiry: 43, severity: 'high' },
    { appId: 'dddddddd-0000-0000-0000-000000000004', displayName: 'monitoring-sp', credentialType: 'certificate', credentialId: 'kid-004', expiresAt: '2026-09-15T00:00:00Z', daysTillExpiry: 79, severity: 'medium' },
];

const MOCK_RESPONSE = {
    success: true, mock: true, items: MOCK_ITEMS,
    counts: { critical: 1, high: 2, medium: 1 },
};

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        if (!tenantId) return NextResponse.json({ error: "Falta tenantId" }, { status: 400 });
        const daysAhead = parseInt(searchParams.get('daysAhead') || '90', 10);

        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
        const decoded = jwt.decode(authHeader.split(" ")[1]) as any;
        if (!decoded?.tid) return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        const email = (decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "").toLowerCase();
        const isSuperAdmin = email.endsWith("@cscloudsolutions.com.ar");
        if (decoded.tid !== tenantId && !isSuperAdmin) return NextResponse.json({ error: "Acceso denegado al tenant." }, { status: 403 });

        if (isMockTenant(tenantId)) return NextResponse.json(MOCK_RESPONSE);

        try {
            const [rows]: any = await pool.query(
                'SELECT * FROM ExpiringCredentials WHERE tenant_id = ? AND days_till_expiry <= ? ORDER BY days_till_expiry ASC',
                [tenantId, daysAhead]
            );
            const items = rows || [];
            const counts = { critical: 0, high: 0, medium: 0 };
            items.forEach((r: any) => {
                const s = r.severity as keyof typeof counts;
                if (s in counts) counts[s]++;
            });
            return NextResponse.json({ success: true, mock: false, items, counts });
        } catch {
            return NextResponse.json(MOCK_RESPONSE);
        }
    } catch {
        return NextResponse.json(MOCK_RESPONSE);
    }
}
