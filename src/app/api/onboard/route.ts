import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool, { initializeDatabase } from "@/lib/db";

export async function POST(request: NextRequest) {
    try {
        // Garantizamos que las tablas existan
        await initializeDatabase();

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "Falta token Bearer de autenticación." }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;

        if (!decoded || !decoded.tid || !decoded.oid) {
            return NextResponse.json({ error: "Token inválido o incompleto." }, { status: 400 });
        }

        const tenantId = decoded.tid;
        const entraOid = decoded.oid;
        const email = decoded.preferred_username || decoded.email || "Unknown";
        
        let companyName = "Entorno: " + tenantId.substring(0,8);
        if (email.includes('@')) {
            companyName = email.split('@')[1];
        }

        const connection = await pool.getConnection();
        
        try {
            await connection.beginTransaction();

            // UPSERT Tenant (Insert or Update)
            const insertTenantQuery = `
                INSERT INTO Tenants (tenant_id, company_name) 
                VALUES (?, ?) 
                ON DUPLICATE KEY UPDATE company_name = ?
            `;
            await connection.query(insertTenantQuery, [tenantId, companyName, companyName]);

            // UPSERT User
            const insertUserQuery = `
                INSERT INTO Users (entra_oid, tenant_id, email) 
                VALUES (?, ?, ?) 
                ON DUPLICATE KEY UPDATE email = ?
            `;
            await connection.query(insertUserQuery, [entraOid, tenantId, email, email]);

            await connection.commit();
        } catch (dbError) {
            await connection.rollback();
            throw dbError;
        } finally {
            connection.release();
        }

        return NextResponse.json({ success: true, message: "Onboarding completado exitosamente en base de datos." });

    } catch (error: any) {
        console.error("Onboard API Error:", error);
        return NextResponse.json({ error: "Error interno del servidor", details: error.message }, { status: 500 });
    }
}
