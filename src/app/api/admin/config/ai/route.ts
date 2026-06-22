import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { verifySubscription } from '@/lib/apiSecurity';
import jwt from "jsonwebtoken";

export async function PATCH(request: NextRequest) {
    try {
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) return NextResponse.json({ error: "Falta token" }, { status: 401 });

        const token = authHeader.split(" ")[1];
        const decoded = jwt.decode(token) as any;
        if (!decoded) return NextResponse.json({ error: "Token inválido" }, { status: 401 });

        const email = decoded.unique_name || decoded.preferred_username || decoded.email || "";

        const body = await request.json();
        const { tenantId, aiProvider, aiApiKey } = body;

        if (!tenantId) {
            return NextResponse.json({ error: 'Falta tenantId' }, { status: 400 });
        }

        // Verify the user is an admin of this tenant
        const [userRows] = await pool.query('SELECT role, system_role FROM Users WHERE email = ? AND tenant_id = ? LIMIT 1', [email, tenantId]);
        const user = (userRows as any[])[0];
        const isSuperAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar") && user?.system_role === 'SUPERADMIN';

        if (!user || (user.role !== 'Admin' && !isSuperAdmin)) {
            return NextResponse.json({ error: 'Solo los administradores pueden configurar la IA.' }, { status: 403 });
        }

        const isAuthorized = await verifySubscription(tenantId);
        if (!isAuthorized) {
            return NextResponse.json({ error: 'Forbidden: Active subscription required' }, { status: 403 });
        }

        await pool.query(
            'UPDATE Tenants SET ai_provider = ?, ai_api_key = ? WHERE tenant_id = ?',
            [aiProvider || 'system', aiApiKey || null, tenantId]
        );

        return NextResponse.json({ success: true, message: 'Configuración guardada exitosamente.' });
    } catch (error: any) {
        console.error('API PATCH /admin/config/ai error:', error);
        return NextResponse.json({ error: 'Fallo al guardar la configuración' }, { status: 500 });
    }
}
