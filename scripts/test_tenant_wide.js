const { ClientSecretCredential } = require("@azure/identity");
const { ResourceGraphClient } = require("@azure/arm-resourcegraph");
const mysql = require('mysql2/promise');

async function testQuery(client, subs) {
    const query = "Resources | summarize count()";
    try {
        const res = await client.resources({
            subscriptions: subs,
            query: query
        });
        console.log(`Query for ${JSON.stringify(subs)}: SUCCESS, count =`, res.data);
        return true;
    } catch (e) {
        console.log(`Query for ${JSON.stringify(subs)}: FAILED. Error:`, e.message || e);
        return false;
    }
}

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
        const client = new ResourceGraphClient(credential);
        
        const subs = [
            '6e9e770e-cd08-4a32-ad90-a83b72a832f0',
            '3f45daab-7629-40b9-a9a3-2b3ded312b99',
            '292fdd9f-2ff3-465b-9091-d554c1af4456'
        ];
        
        console.log("--- Testing each subscription individually ---");
        const results = [];
        for (const sub of subs) {
            const success = await testQuery(client, [sub]);
            results.push({ sub, success });
        }
        
        console.log("\n--- Testing all subscriptions together ---");
        await testQuery(client, subs);
        
        console.log("\n--- Testing only successful subscriptions together ---");
        const successfulSubs = results.filter(r => r.success).map(r => r.sub);
        if (successfulSubs.length > 0) {
            await testQuery(client, successfulSubs);
        } else {
            console.log("No successful subscriptions found!");
        }
        
    } catch (e) {
        console.error("Error encountered:", e);
    }
}

main();
