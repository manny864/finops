import pool from '@/modules/storage/db';

export async function verifySubscription(tenantId: string): Promise<boolean> {
    if (!tenantId) return false;
    try {
        const [rows] = await pool.query('SELECT subscription_status FROM Tenants WHERE tenant_id = ?', [tenantId]);
        if (!rows || (rows as any[]).length === 0) return false;
        
        const status = (rows as any[])[0].subscription_status;
        return status === 'ACTIVE' || status === 'TRIAL';
    } catch (error) {
        console.error('Error in verifySubscription:', error);
        return false; // Fail safe
    }
}
