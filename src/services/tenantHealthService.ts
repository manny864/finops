import pool from '@/modules/storage/db';

export async function verifyTenantCredentials(tenantId: string): Promise<{ success: boolean; error?: string }> {
    // 1. Fetch credentials from DB
    const [rows] = await pool.query<any[]>(
        'SELECT client_id, client_secret FROM Tenants WHERE tenant_id = ?',
        [tenantId]
    );

    if (rows.length === 0) {
        return { success: false, error: 'Tenant no encontrado en la base de datos.' };
    }

    const { client_id: clientId, client_secret: clientSecret } = rows[0];

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
        const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
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

    } catch (e: any) {
        console.error(`Heartbeat check failed for tenant ${tenantId}:`, e.message);
        
        // Update DB status to ERROR
        await pool.query(
            "UPDATE Tenants SET last_sync_at = CURRENT_TIMESTAMP, sync_status = 'ERROR', last_error_message = ? WHERE tenant_id = ?",
            [e.message, tenantId]
        );

        return { success: false, error: e.message };
    }
}
