import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool, { initializeDatabase } from "@/modules/storage/db";

export async function POST(request: NextRequest) {
    try {
        await initializeDatabase();
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }
        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded) return NextResponse.json({ error: "Token inválido." }, { status: 401 });

        const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
        const isSuperAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") && decoded.tid === "8b41364f-581a-4e43-b7cb-13138dac5517";

        if (!isSuperAdmin) {
            return NextResponse.json({ error: "Acceso denegado. Solo SuperAdmins." }, { status: 403 });
        }

        const body = await request.json();
        const { tenantId, name, tier } = body;

        if (!tenantId || !name) {
            return NextResponse.json({ error: 'Faltan datos obligatorios (tenantId, name)' }, { status: 400 });
        }

        const selectedTier = tier || 'Essential';

        await pool.query(
            'INSERT INTO Tenants (tenant_id, company_name, tier, subscription_status) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE company_name = VALUES(company_name), tier = VALUES(tier), subscription_status = VALUES(subscription_status)',
            [tenantId, name, selectedTier, 'ACTIVE']
        );

        return NextResponse.json({ success: true, message: 'Tenant manual creado exitosamente.' });
    } catch (error: any) {
        console.error('API POST /admin/tenants error:', error);
        return NextResponse.json({ error: 'Fallo al crear Tenant manual', details: error.message }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        await initializeDatabase();
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }
        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded) return NextResponse.json({ error: "Token inválido." }, { status: 401 });

        const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
        const isSuperAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") && decoded.tid === "8b41364f-581a-4e43-b7cb-13138dac5517";

        if (!isSuperAdmin) {
            return NextResponse.json({ error: "Acceso denegado. Solo SuperAdmins." }, { status: 403 });
        }

        const body = await request.json();
        const { tenantId, tier } = body;

        if (!tenantId || !tier) {
            return NextResponse.json({ error: 'Faltan datos (tenantId, tier)' }, { status: 400 });
        }

        await pool.query(
            'UPDATE Tenants SET tier = ? WHERE tenant_id = ?',
            [tier, tenantId]
        );

        return NextResponse.json({ success: true, message: 'Tier actualizado exitosamente.' });
    } catch (error: any) {
        console.error('API PATCH /admin/tenants error:', error);
        return NextResponse.json({ error: 'Fallo al actualizar Tier', details: error.message }, { status: 500 });
    }
}
