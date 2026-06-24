import { NextRequest, NextResponse } from 'next/server';
import { generateFinOpsReport } from '@/services/aiService';
import pool from '@/modules/storage/db';
import { RowDataPacket } from 'mysql2';
import jwt from 'jsonwebtoken';

export async function POST(request: NextRequest) {
    try {
        // Auth validation
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer." }, { status: 401 });
        }
        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded || !decoded.tid) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }

        const { tenantId, metricsData } = await request.json();

        if (!tenantId) {
            return NextResponse.json({ error: "Tenant ID is required" }, { status: 400 });
        }

        // SuperAdmin check for cross-tenant access
        const email = decoded.preferred_username || decoded.unique_name || decoded.upn || decoded.email || "";
        const isSuperAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") && decoded.tid === "8b41364f-581a-4e43-b7cb-13138dac5517";

        if (decoded.tid !== tenantId && !isSuperAdmin) {
            return NextResponse.json({ error: "Acceso denegado al tenant." }, { status: 403 });
        }

        // Validate tenant exists
        const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM Tenants WHERE tenant_id = ?', [tenantId]);
        if (rows.length === 0) {
            return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
        }

        const report = await generateFinOpsReport(tenantId, metricsData);

        return NextResponse.json({ report });
    } catch (error: any) {
        console.error("Error generating AI report:", error);
        return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
    }
}
