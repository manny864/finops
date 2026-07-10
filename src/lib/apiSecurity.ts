import pool from '@/modules/storage/db';

export async function verifySubscription(tenantId: string): Promise<boolean> {
    if (!tenantId) return false;
    try {
        const [rows] = await pool.query('SELECT subscription_status, access_until FROM Tenants WHERE tenant_id = ?', [tenantId]);
        if (!rows || (rows as any[]).length === 0) return false;

        const { subscription_status: status, access_until: accessUntil } = (rows as any[])[0];
        if (status === 'ACTIVE' || status === 'TRIAL') return true;
        // Cancelado pero todavía dentro del período ya pagado (ver
        // /api/webhooks/paddle y /api/cron/subscription-expiry): no revocar
        // acceso antes de tiempo.
        if (status === 'CANCELED' && accessUntil && new Date(accessUntil) > new Date()) return true;
        return false;
    } catch (error) {
        console.error('Error in verifySubscription:', error);
        return false; // Fail safe
    }
}
