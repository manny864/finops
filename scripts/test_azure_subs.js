const { ClientSecretCredential } = require("@azure/identity");
const mysql = require("mysql2/promise");
const fs = require("fs");

const envText = fs.readFileSync(".env.local", "utf-8");
envText.split("\\n").forEach(line => {
    if(line.includes("=")) {
        const [k, v] = line.split("=");
        process.env[k] = v;
    }
});

async function main() {
    try {
        const tenantId = "8b41364f-581a-4e43-b7cb-13138dac5517"; // The one from the screenshot
        const clientId = process.env.AZURE_CLIENT_ID;
        
        console.log("Connecting to DB to get secret for tenant:", tenantId);
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
        console.log("Got client secret.");

        const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
        console.log("Getting token...");
        const tokenResponse = await credential.getToken("https://management.azure.com/.default");
        
        console.log("Calling Subscriptions API...");
        const fetchRes = await fetch("https://management.azure.com/subscriptions?api-version=2020-01-01", {
            headers: { "Authorization": `Bearer ${tokenResponse.token}` }
        });
        
        const data = await fetchRes.json();
        console.log("Response status:", fetchRes.status);
        console.log("Response data:", JSON.stringify(data, null, 2));

        process.exit(0);
    } catch (e) {
        console.error("Error:", e);
        process.exit(1);
    }
}
main();
