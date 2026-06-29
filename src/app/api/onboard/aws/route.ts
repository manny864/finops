import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { AuthError, requireTenantAccess } from "@/lib/requestAuth";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, roleArn, s3BucketUri } = body;

        if (!tenantId || (!roleArn && !s3BucketUri)) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId, y (roleArn o s3BucketUri)" }, { status: 400 });
        }

        const identity = await requireTenantAccess(request, tenantId, { allowSuperAdmin: true });

        // Validate Enterprise Tier
        const [tenants] = await pool.query('SELECT tier FROM Tenants WHERE tenant_id = ?', [tenantId]);
        if (!Array.isArray(tenants) || tenants.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }

        const tier = (tenants[0] as { tier?: string }).tier;
        if (!tier) {
            return NextResponse.json({ error: "Tier inválido para tenant." }, { status: 400 });
        }
        const normalizedTier = tier.toLowerCase();
        if (normalizedTier !== 'enterprise') {
             return NextResponse.json({ error: "La ingesta Multi-Cloud está reservada para el plan Enterprise." }, { status: 403 });
        }

        // Save AWS Config to Database
        // We'll store it as a JSON in GlobalSettings for now (as a mock/demo approach)
        await pool.query(
            `INSERT INTO GlobalSettings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
            [`aws_config_${tenantId}`, JSON.stringify({ roleArn, s3BucketUri })]
        );

        // Generate an action log
        await pool.query(
            `INSERT INTO ActionLogs (tenant_id, action_type, resource_id, status, user_email) 
             VALUES (?, ?, ?, ?, ?)`,
            [tenantId, 'AWS_Onboarding', 'MultiCloud', 'Success', identity.email || 'unknown']
        );

        return NextResponse.json({ 
            success: true, 
            message: "Configuración de AWS guardada. Los reportes CUR se ingerirán periódicamente."
        });

    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("AWS Onboarding API Error:", error);
        return NextResponse.json({ error: "Fallo al guardar la configuración AWS." }, { status: 500 });
    }
}
