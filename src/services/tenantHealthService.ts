import pool from '@/modules/storage/db';
import { getTenantCredentials } from '@/lib/secrets/tenantCredentials';
import { errorMessage } from '@/lib/apiErrors';

export async function verifyTenantCredentials(tenantId: string): Promise<{ success: boolean; error?: string }> {
    // 1. Fetch credentials from KV (with DB fallback)
    const clean = (v: any) => (typeof v === 'string' ? v.trim().replace(/^["']+|["']+$/g, '') : v);
    const cleanTid = clean(tenantId);
    const creds = await getTenantCredentials(cleanTid);
    const clientId = creds?.clientId || '';
    const clientSecret = creds?.clientSecret || '';

    if (!clientId || !clientSecret) {
        const errorMsg = 'Credenciales de Azure (Client ID y Client Secret) no configuradas.';
        await pool.query(
            "UPDATE Tenants SET last_sync_at = CURRENT_TIMESTAMP, sync_status = 'ERROR', last_error_message = ? WHERE tenant_id = ?",
            [errorMsg, tenantId]
        );
        return { success: false, error: errorMsg };
    }

    try {
        // 2. Request token from login.microsoftonline.com
        const tokenUrl = `https://login.microsoftonline.com/${cleanTid}/oauth2/v2.0/token`;
        const body = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'https://management.azure.com/.default'
        });

        const tokenResponse = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString()
        });

        if (!tokenResponse.ok) {
            const errJson = await tokenResponse.json().catch(() => ({}));
            const errMsg = errJson.error_description || errJson.error || `HTTP ${tokenResponse.status}`;
            throw new Error(`Fallo de Autenticación Azure AD: ${errMsg}`);
        }

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        if (!accessToken) {
            throw new Error('No se recibió token de acceso de Azure.');
        }

        // 3. Verify ARM API access by calling a lightweight API (listing subscriptions)
        const armUrl = 'https://management.azure.com/subscriptions?api-version=2020-01-01';
        const armResponse = await fetch(armUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!armResponse.ok) {
            const armErrJson = await armResponse.json().catch(() => ({}));
            const armErrMsg = armErrJson.error?.message || `HTTP ${armResponse.status}`;
            throw new Error(`Fallo de Permiso Azure ARM: ${armErrMsg}`);
        }

        // Update DB status to OK
        await pool.query(
            "UPDATE Tenants SET last_sync_at = CURRENT_TIMESTAMP, sync_status = 'OK', last_error_message = NULL WHERE tenant_id = ?",
            [tenantId]
        );

        return { success: true };

    } catch (e) {
        console.error(`Heartbeat check failed for tenant ${tenantId}:`, errorMessage(e));
        
        // Update DB status to ERROR
        await pool.query(
            "UPDATE Tenants SET last_sync_at = CURRENT_TIMESTAMP, sync_status = 'ERROR', last_error_message = ? WHERE tenant_id = ?",
            [errorMessage(e), tenantId]
        );

        return { success: false, error: errorMessage(e) };
    }
}
