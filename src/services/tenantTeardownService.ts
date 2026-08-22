import pool from '@/modules/storage/db';

/**
 * Purga en cascada los datos locales de un tenant.
 *
 * **`ActionLogs` se preserva a propósito.** Es la bitácora de acciones
 * administrativas, y la baja de un entorno es justo el evento que después hay
 * que poder auditar: borrarla dejaría la purga sin rastro y eliminaría la
 * evidencia de todo lo que se hizo en ese tenant antes de darlo de baja. El
 * `tenant_id` queda huérfano en la tabla, que es exactamente lo que se quiere.
 */
export async function teardownTenant(
    tenantId: string,
    purgedByEmail?: string
): Promise<boolean> {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Sellar la purga en la bitácora ANTES de borrar, para que el registro
        //    quede escrito dentro de la misma transacción que la elimina.
        try {
            await connection.execute(
                `INSERT INTO ActionLogs (tenant_id, user_email, action_type, resource_id, status)
                 VALUES (?, ?, 'TENANT_PURGE', ?, 'SUCCESS')`,
                [tenantId, purgedByEmail || 'system', tenantId]
            );
        } catch (e: any) {
            // Una bitácora incompleta es mala; abortar la baja porque no se pudo
            // escribir la línea es peor (mismo criterio que `recordAuthEvent`).
            console.warn(`No se pudo registrar TENANT_PURGE para ${tenantId}: ${e.message}`);
        }

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
