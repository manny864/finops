import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pool from "@/modules/storage/db";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, roleArn, s3BucketUri } = body;

        if (!tenantId || (!roleArn && !s3BucketUri)) {
            return NextResponse.json({ error: "Faltan parámetros requeridos: tenantId, y (roleArn o s3BucketUri)" }, { status: 400 });
        }

        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return NextResponse.json({ error: "No autorizado." }, { status: 401 });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;

        if (!decoded) {
            return NextResponse.json({ error: "Token inválido." }, { status: 401 });
        }

        // Validate Enterprise Tier
        const [tenants]: any = await pool.query('SELECT tier FROM Tenants WHERE id = ?', [tenantId]);
        if (!tenants || tenants.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }

        const tier = tenants[0].tier;
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
            [tenantId, 'AWS_Onboarding', 'MultiCloud', 'Success', decoded.preferred_username || decoded.email || 'unknown']
        );

        return NextResponse.json({ 
            success: true, 
            message: "Configuración de AWS guardada. Los reportes CUR se ingerirán periódicamente."
        });

    } catch (error: any) {
        console.error("AWS Onboarding API Error:", error);
        return NextResponse.json({ error: "Fallo al guardar la configuración AWS.", details: error.message }, { status: 500 });
    }
}
