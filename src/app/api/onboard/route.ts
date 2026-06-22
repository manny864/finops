import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool, { initializeDatabase } from "@/modules/storage/db";

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
        
        // Extraemos plan del body
        let reqBody: any = {};
        try {
            reqBody = await request.json();
        } catch (e) {
            // Ignore if no body
        }
        const plan = reqBody.plan || 'Essential';
        
        let tier = 'Essential';
        let subStatus = 'PENDING_PAYMENT';
        let trialInterval = 0;
        
        if (plan === 'pro') {
            tier = 'Professional';
            subStatus = 'TRIAL';
            trialInterval = 14;
        } else if (plan === 'business') {
            tier = 'Business';
            subStatus = 'TRIAL';
            trialInterval = 14;
        } else if (plan === 'enterprise') {
            tier = 'Enterprise';
        }

        let companyName = "Entorno: " + tenantId.substring(0,8);
        if (email.includes('@')) {
            companyName = email.split('@')[1];
        }

        const connection = await pool.getConnection();
        
        try {
            await connection.beginTransaction();

            // Insert Tenant (Ignore if already exists to preserve custom names)
            // Asignamos el tier si es nuevo, sino lo mantenemos
            let trialEndsAtValue = null;
            if (trialInterval > 0) {
                const now = new Date();
                now.setDate(now.getDate() + trialInterval);
                trialEndsAtValue = now.toISOString().slice(0, 19).replace('T', ' ');
            }

            const insertTenantQuery = `
                INSERT IGNORE INTO Tenants (tenant_id, company_name, tier, subscription_status, trial_ends_at) 
                VALUES (?, ?, ?, ?, ?) 
            `;
            await connection.query(insertTenantQuery, [tenantId, companyName, tier, subStatus, trialEndsAtValue]);

            // Determine role and system_role for this user
            let userRole = 'Admin'; // First user in a tenant is always the Admin (owner)
            let systemRole = 'USER';
            
            // Auto-promote CSCloudSolutions master tenant admins to SUPERADMIN
            if (email.toLowerCase().endsWith('@cscloudsolutions.com.ar') && tenantId === '8b41364f-581a-4e43-b7cb-13138dac5517') {
                systemRole = 'SUPERADMIN';
            }

            // UPSERT User with explicit role and system_role
            const insertUserQuery = `
                INSERT INTO Users (entra_oid, tenant_id, email, role, system_role) 
                VALUES (?, ?, ?, ?, ?) 
                ON DUPLICATE KEY UPDATE email = ?, role = CASE WHEN role IS NULL OR role = '' OR role = 'admin' THEN VALUES(role) ELSE role END
            `;
            await connection.query(insertUserQuery, [entraOid, tenantId, email, userRole, systemRole, email]);

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
