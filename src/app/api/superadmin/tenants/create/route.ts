import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { errorMessage, errorStatus } from '@/lib/apiErrors';

export async function POST(request: NextRequest) {
    try {
        await requireSuperAdmin(request);

        const body = await request.json();
        const { tenantName, domain, adminEmail } = body;

        if (!tenantName || !domain || !adminEmail) {
            return NextResponse.json({ error: "Faltan campos requeridos (tenantName, domain, adminEmail)." }, { status: 400 });
        }

        const tenantId = domain;

        await pool.query(
            "INSERT INTO Tenants (tenant_id, company_name, tier, subscription_status) VALUES (?, ?, 'Enterprise', 'ACTIVE') ON DUPLICATE KEY UPDATE company_name = VALUES(company_name), tier = VALUES(tier), subscription_status = VALUES(subscription_status)",
            [tenantId, tenantName]
        );

        return NextResponse.json({ success: true, tenantId });

    } catch (error) {
        if (error instanceof AuthError) return NextResponse.json({ error: errorMessage(error) }, { status: errorStatus(error) });
        console.error("[SuperAdmin Create Tenant Error]", error);
        return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
    }
}
