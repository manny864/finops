import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool from "@/modules/storage/db";

export async function POST(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;

        if (!decoded) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }

        const email = decoded.unique_name || decoded.preferred_username || "";
        const isSuperAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") && decoded.tid === "8b41364f-581a-4e43-b7cb-13138dac5517";

        if (!isSuperAdmin) {
            return NextResponse.json({ error: "Acceso denegado. Se requiere rol SuperAdmin." }, { status: 403 });
        }

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

    } catch (error: any) {
        console.error("[SuperAdmin Create Tenant Error]", error);
        return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
    }
}
