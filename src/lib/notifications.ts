import pool from "@/modules/storage/db";
import { assertSafeWebhookUrl } from "@/lib/webhookSecurity";
import { sendEmailAsync } from "@/lib/emailHelper";

export type Severity = 'info' | 'warning' | 'error';

export interface NotificationPayload {
    title: string;
    message: string;
    severity?: Severity;
    link?: string;
    metadata?: Record<string, unknown>;
}

export interface NotificationResult {
    sent: number;
    failed: number;
    results: Array<{
        channelId: number;
        type: string;
        success: boolean;
        error?: string;
    }>;
}

// ===== PRIVATE: Per-channel senders =====

interface SlackConfig {
    webhook_url: string;
}

async function sendToSlack(config: SlackConfig, payload: NotificationPayload): Promise<void> {
    const emoji = payload.severity === 'warning' ? '🟡' : payload.severity === 'error' ? '🔴' : '🟢';
    const body = {
        text: payload.title,
        blocks: [
            {
                type: "header",
                text: {
                    type: "plain_text",
                    text: `${emoji} ${payload.title}`,
                },
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: payload.message,
                },
            },
        ],
    };

    if (payload.link) {
        (body.blocks as any).push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: `<${payload.link}|Ver detalle>`,
            },
        });
    }

    (body.blocks as any).push({
        type: "context",
        elements: [
            {
                type: "mrkdwn",
                text: `FinOps SaaS · ${new Date().toISOString()}`,
            },
        ],
    });

    await assertSafeWebhookUrl(config.webhook_url);
    const response = await fetch(config.webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(`Slack webhook returned ${response.status}: ${response.statusText}`);
    }
}

interface TeamsConfig {
    webhook_url: string;
}

async function sendToTeams(config: TeamsConfig, payload: NotificationPayload): Promise<void> {
    const emoji = payload.severity === 'warning' ? '🟡' : payload.severity === 'error' ? '🔴' : '🟢';
    const color = payload.severity === 'warning' ? 'Warning' : payload.severity === 'error' ? 'Attention' : 'Good';

    const adaptiveCard = {
        type: "message",
        attachments: [
            {
                contentType: "application/vnd.microsoft.card.adaptive",
                content: {
                    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
                    type: "AdaptiveCard",
                    version: "1.4",
                    body: [
                        {
                            type: "TextBlock",
                            size: "Large",
                            weight: "Bolder",
                            text: `${emoji} ${payload.title}`,
                            color: color,
                        },
                        {
                            type: "TextBlock",
                            text: payload.message,
                            wrap: true,
                        },
                    ],
                    actions: payload.link
                        ? [
                            {
                                type: "Action.OpenUrl",
                                title: "Ver detalle",
                                url: payload.link,
                            },
                        ]
                        : [],
                },
            },
        ],
    };

    await assertSafeWebhookUrl(config.webhook_url);
    const response = await fetch(config.webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adaptiveCard),
    });

    if (!response.ok) {
        throw new Error(`Teams webhook returned ${response.status}: ${response.statusText}`);
    }
}

interface EmailConfig {
    recipients: string[];
}

// Envía vía Microsoft Graph (mismo mecanismo que leads/invoicing en
// emailHelper.ts), no SMTP. Antes dependía de SMTP_HOST/USER/PASSWORD, que
// nunca estuvieron configurados en prod — el canal de email de Alertas
// Self-Service fallaba en silencio (console.warn, sin error visible).
async function sendToEmail(config: EmailConfig, payload: NotificationPayload): Promise<void> {
    const html = `
        <h2>${payload.title}</h2>
        <p>${payload.message}</p>
        ${payload.link ? `<p><a href="${payload.link}">Ver detalle</a></p>` : ""}
        <hr />
        <p style="color: #999; font-size: 12px;">FinOps SaaS · ${new Date().toISOString()}</p>
    `;
    const subject = `[${(payload.severity || "info").toUpperCase()}] ${payload.title}`;

    await Promise.all(
        config.recipients.map((recipient) => sendEmailAsync(subject, html, recipient))
    );
}

// ===== PUBLIC API =====

export async function notifyTenant(tenantId: string, payload: NotificationPayload): Promise<NotificationResult> {
    const severity = payload.severity || "info";
    const results: Array<{ channelId: number; type: string; success: boolean; error?: string }> = [];

    try {
        // Fetch enabled notification channels
        const [channels] = await pool.query(
            `SELECT id, type, name, config_json, severity_filter FROM NotificationChannels
             WHERE tenant_id = ? AND enabled = TRUE
             ORDER BY created_at ASC`,
            [tenantId]
        );

        const channelList = channels as any[];

        // Send to each channel (filtered by severity)
        const sendPromises = channelList.map(async (channel) => {
            const channelId = channel.id;
            const channelType = channel.type;
            const config = JSON.parse(channel.config_json);
            const severityFilter = channel.severity_filter || "info,warning,error";

            // Check if severity matches filter
            if (!severityFilter.split(",").map((s: string) => s.trim()).includes(severity)) {
                return {
                    channelId,
                    type: channelType,
                    success: false,
                    error: "Severity not in filter",
                };
            }

            try {
                if (channelType === "slack") {
                    await sendToSlack(config, payload);
                } else if (channelType === "teams") {
                    await sendToTeams(config, payload);
                } else if (channelType === "email") {
                    await sendToEmail(config, payload);
                }

                // Log success
                await pool.query(
                    `INSERT INTO NotificationLog (tenant_id, channel_id, channel_type, title, message, severity, status)
                     VALUES (?, ?, ?, ?, ?, ?, 'success')`,
                    [tenantId, channelId, channelType, payload.title, payload.message, severity]
                );

                return {
                    channelId,
                    type: channelType,
                    success: true,
                };
            } catch (error: any) {
                const errorMsg = error?.message || String(error);

                // Log failure
                await pool.query(
                    `INSERT INTO NotificationLog (tenant_id, channel_id, channel_type, title, message, severity, status, error_message)
                     VALUES (?, ?, ?, ?, ?, ?, 'failed', ?)`,
                    [tenantId, channelId, channelType, payload.title, payload.message, severity, errorMsg]
                );

                return {
                    channelId,
                    type: channelType,
                    success: false,
                    error: errorMsg,
                };
            }
        });

        const sendResults = await Promise.allSettled(sendPromises);
        for (const result of sendResults) {
            if (result.status === "fulfilled") {
                results.push(result.value);
            } else {
                // Shouldn't happen but handle edge case
                results.push({
                    channelId: 0,
                    type: "unknown",
                    success: false,
                    error: result.reason?.message || "Unknown error",
                });
            }
        }

        // Backward compatibility: if no channels and tenant has webhook_url, send to webhook
        if (channelList.length === 0) {
            const [tenantRows] = await pool.query(
                "SELECT webhook_url FROM Tenants WHERE tenant_id = ?",
                [tenantId]
            );
            const tenants = tenantRows as any[];
            if (tenants.length > 0 && tenants[0].webhook_url) {
                try {
                    await sendLegacyWebhookAlert(tenants[0].webhook_url, payload);
                    results.push({
                        channelId: 0,
                        type: "legacy_webhook",
                        success: true,
                    });
                } catch (error: any) {
                    results.push({
                        channelId: 0,
                        type: "legacy_webhook",
                        success: false,
                        error: error?.message,
                    });
                }
            }
        }

        const sent = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;

        return { sent, failed, results };
    } catch (error: any) {
        console.error("notifyTenant failed:", error);
        return { sent: 0, failed: 1, results: [{ channelId: 0, type: "error", success: false, error: error?.message }] };
    }
}

// ===== LEGACY: Backward compatibility =====

// Exportado: lo usa también el evaluador de AlertRules (credential_expiry),
// donde el webhook (Slack/Teams/Power Automate) viene en channel_target.
export async function sendLegacyWebhookAlert(webhookUrl: string, payload: NotificationPayload): Promise<void> {
    const isPowerAutomate = webhookUrl.includes("powerautomate") || webhookUrl.includes("powerplatform");
    let body: any;

    if (isPowerAutomate) {
        body = {
            contentType: "html",
            content: `🚨 <b>${payload.title}</b><br/>${payload.message}`,
        };
    } else {
        let color = "#36a64f";
        if (payload.severity === "warning") color = "#ffae42";
        if (payload.severity === "error") color = "#ff0000";

        body = {
            attachments: [
                {
                    fallback: `${payload.title}: ${payload.message}`,
                    color: color,
                    title: payload.title,
                    text: payload.message,
                    footer: "FinOps SaaS Platform",
                    ts: Math.floor(Date.now() / 1000),
                },
            ],
        };
    }

    await assertSafeWebhookUrl(webhookUrl);
    const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
    }
}

export async function sendWebhookAlert(
    tenantId: string,
    title: string,
    message: string,
    severity: Severity = "info"
): Promise<void> {
    // Delegate to new dispatcher
    await notifyTenant(tenantId, { title, message, severity });
}
