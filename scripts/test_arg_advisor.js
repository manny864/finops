const { ResourceGraphClient } = require("@azure/arm-resourcegraph");
const { ClientSecretCredential } = require("@azure/identity");
const mysql = require("mysql2/promise");
const fs = require("fs");

const envText = fs.readFileSync(".env.development", "utf-8");
envText.split("\\n").forEach(line => {
    if(line.includes("=")) {
        const [k, v] = line.split("=");
        process.env[k] = v;
    }
});

async function main() {
    try {
        const tenantId = "8b41364f-581a-4e43-b7cb-13138dac5517"; 
        const clientId = process.env.AZURE_CLIENT_ID;
        
        const pool = mysql.createPool({
            host: process.env.DB_HOST || "127.0.0.1",
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
        });

        const [rows] = await pool.query('SELECT client_secret FROM Tenants WHERE tenant_id = ?', [tenantId]);
        if (!rows || rows.length === 0) {
            console.error("Tenant not found in DB");
            process.exit(1);
        }
        const clientSecret = rows[0].client_secret;

        const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
        const client = new ResourceGraphClient(credential);
        
        // Test AdvisorResources
        console.log("Querying AdvisorResources for scores...");
        const result = await client.resources({
            query: "AdvisorResources | where type == 'microsoft.advisor/advisorscores'",
            options: { resultFormat: "objectArray" }
        });
        
        console.log("Results:");
        console.log(JSON.stringify(result.data, null, 2));

        // Test fetching all AdvisorResources to see what types exist
        const result2 = await client.resources({
            query: "AdvisorResources | distinct type",
            options: { resultFormat: "objectArray" }
        });
        console.log("AdvisorResource Types:");
        console.log(JSON.stringify(result2.data, null, 2));

        process.exit(0);
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}
main();
