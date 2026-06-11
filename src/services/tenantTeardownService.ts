import pool from '@/modules/storage/db';

export async function teardownTenant(tenantId: string): Promise<boolean> {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Delete from ActionLogs
        await connection.execute(`DELETE FROM ActionLogs WHERE tenant_id = ?`, [tenantId]);

        // 2. Delete from Budgets (CostCenterBudgets)
        await connection.execute(`DELETE FROM CostCenterBudgets WHERE tenant_id = ?`, [tenantId]);

        // 3. Delete from ApprovalRequests (If exists - wrap in try/catch to avoid failure if table is missing)
        try {
            await connection.execute(`DELETE FROM ApprovalRequests WHERE tenant_id = ?`, [tenantId]);
        } catch (e: any) {
            // Ignore error if table doesn't exist
            if (e.code !== 'ER_NO_SUCH_TABLE') {
                console.warn(`Warning during ApprovalRequests deletion: ${e.message}`);
            }
        }

        // 4. Delete from any tenant-specific AI or webhook configuration tables
        // Webhooks are currently stored as a column in Tenants, so no separate table for webhooks.
        // Also delete TaggingPolicies and SavingsHistory
        await connection.execute(`DELETE FROM TaggingPolicies WHERE tenant_id = ?`, [tenantId]);
        await connection.execute(`DELETE FROM SavingsHistory WHERE tenant_id = ?`, [tenantId]);

        // 5. Delete the tenant credentials / users mapping records
        await connection.execute(`DELETE FROM Users WHERE tenant_id = ?`, [tenantId]);

        // 6. Finally, delete the row from the main Tenants table
        await connection.execute(`DELETE FROM Tenants WHERE tenant_id = ?`, [tenantId]);

        await connection.commit();
        return true;
    } catch (error) {
        await connection.rollback();
        console.error(`Failed to teardown tenant ${tenantId}. Transaction rolled back.`, error);
        throw error;
    } finally {
        connection.release();
    }
}
