import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import jwt from "jsonwebtoken";

export async function GET(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) return NextResponse.json({ error: "Falta token" }, { status: 401 });

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded) return NextResponse.json({ error: "Token inválido" }, { status: 401 });

        const email = decoded.unique_name || decoded.preferred_username || decoded.upn || decoded.email || "";

        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');

        if (!tenantId) {
            return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        }

        // Verify the user is an admin of this tenant
        const [userRows] = await pool.query('SELECT role, system_role FROM Users WHERE email = ? AND tenant_id = ? LIMIT 1', [email, tenantId]);
        const user = (userRows as any[])[0];
        const isSuperAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") && decoded.tid === "8b41364f-581a-4e43-b7cb-13138dac5517" && user?.system_role === "SUPERADMIN";

        if (!user || (user.role !== 'Admin' && !isSuperAdmin)) {
            return NextResponse.json({ error: 'Solo los administradores pueden acceder al portal de facturación.' }, { status: 403 });
        }

        // Fetch subscription ID
        const [tenantRows] = await pool.query('SELECT paddle_subscription_id, tier, subscription_status FROM Tenants WHERE tenant_id = ? LIMIT 1', [tenantId]);
        const tenant = (tenantRows as any[])[0];

        if (!tenant) {
            return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });
        }

        if (tenant.tier === 'Enterprise') {
            return NextResponse.json({ isEnterprise: true });
        }

        if (!tenant.paddle_subscription_id) {
            return NextResponse.json({ error: 'No hay suscripción activa configurada para este entorno.' }, { status: 404 });
        }

        // Fetch from Paddle API
        const PADDLE_API_KEY = process.env.PADDLE_API_KEY || '';
        const PADDLE_ENV = process.env.PADDLE_ENV === 'sandbox' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';

        const paddleRes = await fetch(`${PADDLE_ENV}/subscriptions/${tenant.paddle_subscription_id}`, {
            headers: {
                'Authorization': `Bearer ${PADDLE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!paddleRes.ok) {
            console.error('Paddle API Error:', await paddleRes.text());
            return NextResponse.json({ error: 'Error de comunicación con Paddle.' }, { status: 502 });
        }

        const paddleData = await paddleRes.json();
        
        return NextResponse.json({ 
            success: true, 
            managementUrls: paddleData.data?.management_urls || null,
            status: paddleData.data?.status,
            tier: tenant.tier
        });
    } catch (error: any) {
        console.error('API GET /billing/portal error:', error);
        return NextResponse.json({ error: 'Fallo al procesar la solicitud de facturación' }, { status: 500 });
    }
}
