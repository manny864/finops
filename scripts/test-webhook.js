require('dotenv').config({ path: '.env.development' });
const mysql = require('mysql2/promise');

async function test() {
    const tenantId = process.argv[2];
    if (!tenantId) {
        console.error("Por favor, proporciona el tenant_id. Ejemplo: node scripts/test-webhook.js <tenant_id>");
        process.exit(1);
    }

    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'finops_user',
        password: process.env.DB_PASSWORD || 'finopspassword',
        database: process.env.DB_NAME || 'finops_app',
        port: Number(process.env.DB_PORT || 3306)
    });

    console.log(`Buscando webhook para el tenant: ${tenantId}...`);
    try {
        const [rows] = await pool.query("SELECT webhook_url FROM Tenants WHERE tenant_id = ?", [tenantId]);
        
        if (rows.length === 0 || !rows[0].webhook_url) {
            console.error(`No se encontró un webhook configurado para el tenant: ${tenantId}`);
            return;
        }

        const webhookUrl = rows[0].webhook_url;
        console.log(`Webhook encontrado. Enviando notificación de prueba...`);

        const payload = {
            contentType: "html",
            content: "🧪 <b>Alerta de Prueba de Webhook</b><br/>Esta es una notificación de prueba enviada automáticamente para validar la integración de alertas proactivas con Microsoft Teams."
        };

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            console.log("¡Solicitud enviada exitosamente! Revisa tu canal de Teams para verificar si llegó el mensaje.");
        } else {
            console.error(`Error al enviar notificación al webhook: ${response.status} - ${response.statusText}`);
            const body = await response.text();
            console.error("Respuesta del servidor de Teams/Webhook:", body);
        }
    } catch (error) {
        console.error("Error durante la prueba:", error);
    } finally {
        await pool.end();
    }
}

test();
