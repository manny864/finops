import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin, AuthError } from "@/lib/requestAuth";
import pool from "@/modules/storage/db";
import { verifyTenantCredentials } from "@/services/tenantHealthService";

export async function GET(request: NextRequest) {
    try {
        await requireSuperAdmin(request);

        // Fetch tenants health from DB
        const [rows] = await pool.query(
            "SELECT tenant_id as id, company_name as name, client_id, status, last_sync_at, sync_status, last_error_message FROM Tenants ORDER BY company_name ASC"
        );

        return NextResponse.json({ success: true, tenants: rows });

    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("Error listing tenant health:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        await requireSuperAdmin(request);

        const body = await request.json();
        const { tenantId } = body;

        if (!tenantId) {
            return NextResponse.json({ error: "El parámetro tenantId es requerido en el body." }, { status: 400 });
        }

        const result = await verifyTenantCredentials(tenantId);

        return NextResponse.json(result);

    } catch (e: unknown) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("Error verifying tenant credentials:", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
