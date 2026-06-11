import { NextRequest, NextResponse } from 'next/server';
import { getTenantLicensesAndInactiveUsers } from '@/services/licenseService';

export async function GET(request: NextRequest) {
    try {
        const tenantId = request.headers.get('x-tenant-id');

        if (!tenantId || tenantId === 'default') {
            return NextResponse.json({ error: 'Faltan credenciales del entorno' }, { status: 400 });
        }

        const data = await getTenantLicensesAndInactiveUsers(tenantId);

        return NextResponse.json({ success: true, data });
    } catch (error: any) {
        console.error("License API error:", error);
        
        const errorMessage = error.message || '';
        if (errorMessage.includes('403')) {
            return NextResponse.json({ 
                success: false, 
                error: 'Permisos insuficientes en Microsoft Graph.',
                needsConsent: true,
                details: errorMessage
            }, { status: 403 });
        }

        return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
    }
}
