const { ClientSecretCredential } = require("@azure/identity");
const { ResourceGraphClient } = require("@azure/arm-resourcegraph");
const { runGraphAudits } = require("../src/services/auditService");
const mysql = require('mysql2/promise');

async function main() {
    const tenantId = '54d7cf18-0baa-4da7-8242-fbf59a92aaac';
    const startTime = Date.now();
    try {
        const connection = await mysql.createConnection('mysql://finops_user:finopspassword@localhost:3306/finops_app');
        const [rows] = await connection.query('SELECT client_id, client_secret FROM Tenants WHERE tenant_id = ?', [tenantId]);
        await connection.end();
        
        if (rows.length === 0) {
            console.error("Tenant not found in DB");
            return;
        }
        
        const clientId = rows[0].client_id;
        const clientSecret = rows[0].client_secret;
        
        const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
        const client = new ResourceGraphClient(credential);
        
        console.log("Running runGraphAudits tenant-wide...");
        const results = await runGraphAudits(client, credential);
        const duration = (Date.now() - startTime) / 1000;
        
        const totalResourcesFound = Object.values(results).reduce((acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
        console.log(`Finished in ${duration.toFixed(1)} seconds.`);
        console.log(`Success! Total zombie resources found across all categories: ${totalResourcesFound}`);
        
    } catch (e) {
        console.error("Failed running runGraphAudits:", e);
    }
}

main();
