import { NextRequest, NextResponse } from 'next/server';
import pool from '@/modules/storage/db';
import { getTenantCredentials } from '@/lib/secrets/tenantCredentials';
import { requireTenantRole, AuthError } from '@/lib/requestAuth';

export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const tenantId = url.searchParams.get('tenantId');
        const token = url.searchParams.get('token');

        if (!tenantId) {
            return NextResponse.json({ error: "Falta tenantId." }, { status: 400 });
        }

        // Auth: either a Power BI service token (legacy) OR a valid JWT bearer.
        // Power BI machine-to-machine uses ?token=<client_secret>; user browsers use JWT.
        const hasBearerJwt = request.headers.get('authorization')?.startsWith('Bearer ');
        if (!token && !hasBearerJwt) {
            return NextResponse.json({ error: "Faltan credenciales (token o Authorization header)." }, { status: 401 });
        }

        if (token) {
            // Legacy Power BI token path: validate against stored client_secret.
            const creds = await getTenantCredentials(tenantId);
            const validToken = creds?.clientSecret || Buffer.from(tenantId).toString('base64');
            if (token !== validToken) {
                return NextResponse.json({ error: "Token inválido o no autorizado." }, { status: 403 });
            }
        } else {
            // JWT path: validate token and assert tenant membership.
            await requireTenantRole(request, tenantId, ['Admin', 'Owner', 'Reader', 'Colaborador']);
        }

        // Tier gate: Enterprise only.
        const [tenantRows]: any = await pool.query(
            "SELECT tier FROM Tenants WHERE tenant_id = ?",
            [tenantId]
        );
        if (!tenantRows || tenantRows.length === 0) {
            return NextResponse.json({ error: "Tenant no encontrado." }, { status: 404 });
        }
        if (tenantRows[0].tier !== 'Enterprise' && tenantId !== 'default') {
            return NextResponse.json({ error: "Esta característica requiere el plan Enterprise." }, { status: 403 });
        }

        const startDate = url.searchParams.get('startDate') || '1970-01-01';
        const endDate = url.searchParams.get('endDate') || '2099-12-31';

        const [data] = await pool.query(
            `SELECT 
                COALESCE(ChargePeriodStart, date) as ChargePeriodStart, 
                COALESCE(ChargePeriodEnd, date) as ChargePeriodEnd, 
                COALESCE(ProviderName, 'Azure') as ProviderName, 
                COALESCE(PublisherName, 'Microsoft') as PublisherName, 
                COALESCE(SubAccountId, subscription_id) as SubAccountId, 
                COALESCE(BilledCost, cost_usd) as BilledCost, 
                COALESCE(EffectiveCost, cost_usd) as EffectiveCost, 
                COALESCE(CommitmentDiscountId, 'None') as CommitmentDiscountId, 
                COALESCE(Tags, '{}') as Tags,
                service_name as ServiceName,
                resource_group as ResourceGroup
             FROM CostSnapshots
             WHERE tenant_id = ? AND date >= ? AND date <= ?
             ORDER BY date ASC`,
            [tenantId, startDate, endDate]
        );

        // Power BI Web Data Source natively consumes flat JSON arrays easily
        return NextResponse.json(data);
    } catch (e: any) {
        if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("Export API Error:", e);
        return NextResponse.json({ error: "Error interno del servidor", details: e.message }, { status: 500 });
    }
}
