import pool from "@/modules/storage/db";
import { assertSafeWebhookUrl } from "@/lib/webhookSecurity";
import { sendEmailAsync, getNoReplyDisclaimer, getStandardAlertNotificationEmailHtml } from "@/lib/emailHelper";
import { errorMessage } from '@/lib/apiErrors';

export type Severity = 'info' | 'warning' | 'error';

export interface NotificationPayload {
    title: string;
    message: string;
    severity?: Severity;
    link?: string;
    locale?: string;
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

/**
 * Convierte un fallo HTTP del webhook en algo que el admin pueda accionar.
 *
 * Antes se tiraba `Teams webhook returned 405: Method Not Allowed` y nada mas:
 * el cuerpo de la respuesta —que es donde el proveedor explica el motivo— se
 * descartaba, asi que quedaba un codigo y ningun camino.
 *
 * El caso de los 4xx en `webhook.office.com` tiene nombre propio: Microsoft
 * retiro los conectores clasicos de Office 365 en Teams. Una URL vieja de ese
 * dominio ya no recibe entregas y no hay nada que arreglar de este lado — hay
 * que recrear el webhook desde Teams con Workflows (Power Automate), que emite
 * una URL de logic.azure.com. Se acota a 4xx a proposito: un 5xx del mismo
 * host es una caida del servicio, no el retiro, y sugerir la migracion ahi
 * mandaria a rehacer la configuracion por una intermitencia.
 */
async function describeWebhookFailure(
    canal: string,
    url: string,
    response: Response
): Promise<string> {
    const cuerpo = await response.text().catch(() => "");
    const detalle = cuerpo.trim().slice(0, 300);

    let hint = "";
    try {
        const esConectorClasico = /(^|\.)webhook\.office\.com$/i.test(new URL(url).hostname);
        if (esConectorClasico && response.status >= 400 && response.status < 500) {
            hint =
                " Microsoft retiró los conectores clásicos de Office 365: las URLs de webhook.office.com ya no reciben mensajes." +
                " Recreá el webhook en Teams con Workflows (Power Automate) y pegá la URL nueva.";
        }
    } catch {
        // URL invalida: assertSafeWebhookUrl ya la habria rechazado antes.
    }

    return `${canal} webhook returned ${response.status}: ${response.statusText}.${hint}${detalle ? ` Respuesta: ${detalle}` : ""}`;
}

function getDetailsLabel(locale: string = "es"): string {
    const loc = (locale || "es").toLowerCase();
    if (loc.startsWith("en")) return "View details";
    if (loc.startsWith("pt")) return "Ver detalhes";
    return "Ver detalle";
}

function getDisclaimer(locale: string = "es"): string {
    if (typeof getNoReplyDisclaimer === "function") {
        return getNoReplyDisclaimer(locale);
    }
    const loc = (locale || "es").toLowerCase();
    if (loc.startsWith("en")) {
        return "Important: This email is sent from an unattended notification box (alerts@cscloudsolutions.com.ar). Please do not reply directly to this message. If you need support, contact soporte@cscloudsolutions.com.ar.";
    }
    if (loc.startsWith("pt")) {
        return "Aviso importante: Este e-mail é enviado a partir de uma caixa de notificações automática (alerts@cscloudsolutions.com.ar) e não é monitorada. Não responda a esta mensagem. Para suporte, entre em contato com suporte@cscloudsolutions.com.ar.";
    }
    return "Nota importante: Esta es una casilla automatizada de solo envío (alerts@cscloudsolutions.com.ar) y no es monitoreada. Por favor, no respondas a este correo. Para soporte o asistencia técnica, comunícate con soporte@cscloudsolutions.com.ar.";
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
        const linkLabel = getDetailsLabel(payload.locale);
        (body.blocks as any).push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: `<${payload.link}|${linkLabel}>`,
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
        throw new Error(await describeWebhookFailure("Slack", config.webhook_url, response));
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
                                title: getDetailsLabel(payload.locale),
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
        throw new Error(await describeWebhookFailure("Teams", config.webhook_url, response));
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
    const html = typeof getStandardAlertNotificationEmailHtml === "function"
        ? getStandardAlertNotificationEmailHtml({
            title: payload.title,
            message: payload.message,
            severity: payload.severity,
            link: payload.link,
            locale: payload.locale,
            metadata: payload.metadata,
        })
        : `<h2>${payload.title}</h2><p>${payload.message}</p>`;
    const subject = `[${(payload.severity || "info").toUpperCase()}] ${payload.title}`;

    await Promise.all(
        config.recipients.map((recipient) => sendEmailAsync(subject, html, recipient))
    );
}

// ===== PUBLIC API =====

export interface ChannelRow {
    id: number;
    type: string;
    name?: string;
    config_json: unknown;
    severity_filter?: string;
}

export interface ChannelDeliveryOutcome {
    channelId: number;
    type: string;
    success: boolean;
    error?: string;
    latencyMs: number;
}

/**
 * Entrega un payload a UN canal concreto y lo registra en `NotificationLog`.
 *
 * Es el único lugar que despacha: `notifyTenant` lo llama por cada canal del
 * fan-out y la prueba de canal lo llama una sola vez. Antes la prueba usaba
 * `notifyTenant` y filtraba el resultado del canal pedido, así que "probar
 * Slack" también disparaba Teams y Email y dejaba una línea de log por cada
 * uno — un mensaje de prueba en todos los canales de producción.
 *
 * No consulta el interruptor maestro ni el filtro de severidad: eso lo decide
 * el llamador. Una prueba debe verificar que el canal funciona aunque las
 * notificaciones estén apagadas globalmente.
 */
export async function deliverToChannel(
    tenantId: string,
    channel: ChannelRow,
    payload: NotificationPayload
): Promise<ChannelDeliveryOutcome> {
    const severity = payload.severity || "info";
    const channelId = channel.id;
    const channelType = channel.type;
    const startedAt = Date.now();

    try {
        // mysql2 auto-parsea columnas JSON a objetos JS; config_json
        // llega ya parseado, no como string. JSON.parse(objeto) tira
        // SyntaxError y quedaba fuera de este try, perdiéndose sin loguear.
        const config = typeof channel.config_json === "string"
            ? JSON.parse(channel.config_json)
            : channel.config_json;

        if (channelType === "slack") {
            await sendToSlack(config, payload);
        } else if (channelType === "teams") {
            await sendToTeams(config, payload);
        } else if (channelType === "email") {
            await sendToEmail(config, payload);
        } else if (channelType === "webhook") {
            await sendLegacyWebhookAlert(config?.webhookUrl || config?.url, payload);
        } else {
            throw new Error(`Tipo de canal no soportado: ${channelType}`);
        }

        await pool.query(
            `INSERT INTO NotificationLog (tenant_id, channel_id, channel_type, title, message, severity, status)
             VALUES (?, ?, ?, ?, ?, ?, 'success')`,
            [tenantId, channelId, channelType, payload.title, payload.message, severity]
        );

        return { channelId, type: channelType, success: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
        const errorMsg = errorMessage(error) || String(error);

        await pool.query(
            `INSERT INTO NotificationLog (tenant_id, channel_id, channel_type, title, message, severity, status, error_message)
             VALUES (?, ?, ?, ?, ?, ?, 'failed', ?)`,
            [tenantId, channelId, channelType, payload.title, payload.message, severity, errorMsg]
        ).catch(() => { /* el log no debe tapar el error real de envío */ });

        return { channelId, type: channelType, success: false, error: errorMsg, latencyMs: Date.now() - startedAt };
    }
}

export async function notifyTenant(tenantId: string, payload: NotificationPayload): Promise<NotificationResult> {
    const severity = payload.severity || "info";
    const results: Array<{ channelId: number; type: string; success: boolean; error?: string }> = [];

    try {
        // Interruptor maestro (Notificaciones → "Habilitar notificaciones"):
        // apaga TODOS los canales de un saque sin tocar el enabled de cada
        // uno (se conserva esa config para cuando se reactive).
        const [tenantRows] = await pool.query(
            "SELECT notifications_enabled FROM Tenants WHERE tenant_id = ? LIMIT 1",
            [tenantId]
        );
        const notificationsEnabled = Boolean((tenantRows as any[])[0]?.notifications_enabled ?? true);
        if (!notificationsEnabled) {
            return { sent: 0, failed: 0, results: [] };
        }

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
            const severityFilter = channel.severity_filter || "info,warning,error";

            // Check if severity matches filter
            if (!severityFilter.split(",").map((s: string) => s.trim()).includes(severity)) {
                return {
                    channelId: channel.id,
                    type: channel.type,
                    success: false,
                    error: "Severity not in filter",
                };
            }

            const { latencyMs, ...rest } = await deliverToChannel(tenantId, channel, payload);
            void latencyMs;
            return rest;
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
                } catch (error) {
                    results.push({
                        channelId: 0,
                        type: "legacy_webhook",
                        success: false,
                        error: errorMessage(error),
                    });
                }
            }
        }

        const sent = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;

        return { sent, failed, results };
    } catch (error) {
        console.error("notifyTenant failed:", error);
        return { sent: 0, failed: 1, results: [{ channelId: 0, type: "error", success: false, error: errorMessage(error) }] };
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
