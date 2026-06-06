import pool from "@/lib/db";

export async function sendWebhookAlert(tenantId: string, title: string, message: string, severity: 'info' | 'warning' | 'error' = 'info') {
    try {
        const [rows] = await pool.query("SELECT webhook_url FROM Tenants WHERE tenant_id = ?", [tenantId]);
        const tenants = rows as any[];
        
        if (tenants.length === 0 || !tenants[0].webhook_url) {
            return; // No webhook configured
        }

        const webhookUrl = tenants[0].webhook_url;

        let color = "#36a64f"; // default green
        if (severity === 'warning') color = "#ffae42";
        if (severity === 'error') color = "#ff0000";

        // Simple Slack-compatible format that also works for MS Teams standard Incoming Webhooks
        const payload = {
            attachments: [
                {
                    fallback: `${title}: ${message}`,
                    color: color,
                    title: title,
                    text: message,
                    footer: "FinOps SaaS Platform",
                    ts: Math.floor(Date.now() / 1000)
                }
            ]
        };

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error(`Error sending webhook alert: ${response.statusText}`);
        }
    } catch (e) {
        console.error("Failed to execute sendWebhookAlert:", e);
    }
}
