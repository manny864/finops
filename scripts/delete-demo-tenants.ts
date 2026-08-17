import pool, { initializeDatabase } from '../src/modules/storage/db';

async function main() {
    try {
        await initializeDatabase();
        console.log('[delete-demo-tenants] Buscando tenants para eliminar...');
        const [rows]: any = await pool.query(
            `SELECT tenant_id, company_name FROM Tenants 
             WHERE company_name IN ('ACME Cloud', 'Prueba AWS', 'Cliente ACME', 'Cliente Acme', 'Cliente Acme (Demo)')
                OR company_name LIKE '%ACME Cloud%'
                OR company_name LIKE '%Prueba AWS%'
                OR company_name LIKE '%Cliente ACME%'`
        );
        console.log('[delete-demo-tenants] Encontrados:', rows);

        if (Array.isArray(rows) && rows.length > 0) {
            for (const row of rows) {
                console.log(`[delete-demo-tenants] Eliminando tenant ${row.tenant_id} (${row.company_name})...`);
                await pool.query('DELETE FROM Users WHERE tenant_id = ?', [row.tenant_id]);
                await pool.query('DELETE FROM Tenants WHERE tenant_id = ?', [row.tenant_id]);
            }
            console.log('[delete-demo-tenants] Tenants eliminados exitosamente.');
        } else {
            console.log('[delete-demo-tenants] No se encontraron tenants con esos nombres en la base de datos.');
        }
    } catch (e: any) {
        console.warn('[delete-demo-tenants] Aviso de conexión a DB:', e.message);
    }
    process.exit(0);
}

main();
