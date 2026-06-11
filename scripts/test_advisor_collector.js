const { ClientSecretCredential } = require("@azure/identity");
const { AdvisorManagementClient } = require("@azure/arm-advisor");
const mysql = require('mysql2/promise');

async function main() {
    const tenantId = '54d7cf18-0baa-4da7-8242-fbf59a92aaac';
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
        
        const subs = [
            '6e9e770e-cd08-4a32-ad90-a83b72a832f0',
            '3f45daab-7629-40b9-a9a3-2b3ded312b99',
            '292fdd9f-2ff3-465b-9091-d554c1af4456'
        ];
        
        for (const subId of subs) {
            try {
                console.log(`Querying Advisor for subscription ${subId}...`);
                const advisorClient = new AdvisorManagementClient(credential, subId);
                const recs = advisorClient.recommendations.list();
                let count = 0;
                for await (const r of recs) {
                    count++;
                }
                console.log(`Sub ${subId}: Success, found ${count} recommendations.`);
            } catch (err) {
                console.warn(`Sub ${subId} FAILED. Error:`, err.message || err);
            }
        }
    } catch (e) {
        console.error("Main Error:", e);
    }
}

main();
