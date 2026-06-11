import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool from "@/modules/storage/db";
import { verifyTenantCredentials } from "@/services/tenantHealthService";

export async function GET(request: NextRequest) {
    try {
        // Auth check: only SuperAdmins
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;

        if (!decoded) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }

        const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
        const isSuperAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

        if (!isSuperAdmin) {
            return NextResponse.json({ error: "Acceso denegado. Se requiere rol SuperAdmin." }, { status: 403 });
        }

        // Fetch tenants health from DB
        const [rows] = await pool.query(
            "SELECT tenant_id as id, company_name as name, client_id, status, last_sync_at, sync_status, last_error_message FROM Tenants ORDER BY company_name ASC"
        );

        return NextResponse.json({ success: true, tenants: rows });

    } catch (e: any) {
        console.error("Error listing tenant health:", e);
        return NextResponse.json({ error: "Error interno del servidor", details: e.message }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        // Auth check: only SuperAdmins
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;

        if (!decoded) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }

        const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
        const isSuperAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

        if (!isSuperAdmin) {
            return NextResponse.json({ error: "Acceso denegado. Se requiere rol SuperAdmin." }, { status: 403 });
        }

        const body = await request.json();
        const { tenantId } = body;

        if (!tenantId) {
            return NextResponse.json({ error: "El parámetro tenantId es requerido en el body." }, { status: 400 });
        }

        const result = await verifyTenantCredentials(tenantId);

        return NextResponse.json(result);

    } catch (e: any) {
        console.error("Error verifying tenant credentials:", e);
        return NextResponse.json({ error: "Error interno del servidor", details: e.message }, { status: 500 });
    }
}
