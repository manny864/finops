/**
 * Helper for sending emails via Microsoft Graph
 * Fire-and-forget pattern - never blocks the main request
 */

export interface EmailAttachment {
  /** Nombre de archivo mostrado en el mail, ej. "focus-2026-07-19.csv" */
  name: string;
  /** MIME type, ej. "text/csv" */
  contentType: string;
  /** Contenido en base64 (Graph exige base64 para fileAttachment). */
  contentBase64: string;
}

export async function sendEmailAsync(
  subject: string,
  htmlContent: string,
  recipientEmail: string,
  attachments?: EmailAttachment[]
): Promise<void> {
  try {
    const senderEmail = process.env.AZURE_SENDER_EMAIL_ALERTS || process.env.AZURE_SENDER_EMAIL || "alerts@cscloudsolutions.com.ar";
    const tenantId = process.env.MAIL_AZURE_TENANT_ID || process.env.AZURE_TENANT_ID;
    const clientId = process.env.MAIL_AZURE_CLIENT_ID || process.env.AZURE_CLIENT_ID || '';
    const clientSecret = process.env.MAIL_AZURE_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || '';

    if (!tenantId || !clientId || !clientSecret) {
      console.warn("[Email] Azure MS Graph credentials not configured. Skipping email.");
      return;
    }

    // Fire-and-forget: don't await this
    (async () => {
      try {
        const tokenResponse = await fetch(
          `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              scope: 'https://graph.microsoft.com/.default',
              client_secret: clientSecret,
              grant_type: 'client_credentials',
            }),
          }
        );

        if (!tokenResponse.ok) {
          console.error("[Email] Failed to fetch MS Graph token:", await tokenResponse.text());
          return;
        }

        const tokenData = await tokenResponse.json() as any;
        const accessToken = tokenData.access_token;

        const mailPayload = {
          message: {
            subject,
            body: { contentType: 'HTML', content: htmlContent },
            toRecipients: [{ emailAddress: { address: recipientEmail } }],
            attachments: attachments?.map((a) => ({
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: a.name,
              contentType: a.contentType,
              contentBytes: a.contentBase64,
            })),
          },
          saveToSentItems: 'false',
        };

        const sendResponse = await fetch(
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(mailPayload),
          }
        );

        if (!sendResponse.ok) {
          console.error("[Email] Failed to send email:", await sendResponse.text());
        } else {
          console.log(`[Email] Successfully sent "${subject}" to ${recipientEmail}`);
        }
      } catch (err) {
        console.error("[Email] Error sending email:", err);
      }
    })();
  } catch (err) {
    console.error("[Email] Error in sendEmailAsync:", err);
  }
}

/**
 * Variante síncrona/estricta para flujos que necesitan confirmar entrega.
 * Lanza error si falta configuración o Graph responde != 2xx.
 */
export async function sendEmailStrict(
  subject: string,
  htmlContent: string,
  recipientEmail: string,
  attachments?: EmailAttachment[],
  senderOverride?: string
): Promise<void> {
  const senderEmail = senderOverride || process.env.AZURE_SENDER_EMAIL_ALERTS || process.env.AZURE_SENDER_EMAIL || "alerts@cscloudsolutions.com.ar";
  const tenantId = process.env.MAIL_AZURE_TENANT_ID || process.env.AZURE_TENANT_ID;
  const clientId = process.env.MAIL_AZURE_CLIENT_ID || process.env.AZURE_CLIENT_ID || '';
  const clientSecret = process.env.MAIL_AZURE_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || '';

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Credenciales de Azure / Microsoft Graph no configuradas (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET)");
  }

  const tokenResponse = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        scope: 'https://graph.microsoft.com/.default',
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
    }
  );

  if (!tokenResponse.ok) {
    throw new Error(`[Email] Failed to fetch MS Graph token: ${await tokenResponse.text()}`);
  }

  const tokenData = await tokenResponse.json() as any;
  const accessToken = tokenData.access_token;

  const mailPayload = {
    message: {
      subject,
      body: { contentType: 'HTML', content: htmlContent },
      toRecipients: [{ emailAddress: { address: recipientEmail } }],
      attachments: attachments?.map((a) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: a.name,
        contentType: a.contentType,
        contentBytes: a.contentBase64,
      })),
    },
    saveToSentItems: 'false',
  };

  const sendResponse = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mailPayload),
    }
  );

  if (!sendResponse.ok) {
    throw new Error(`[Email] Failed to send email: ${await sendResponse.text()}`);
  }
}

/**
 /**
 * Retorna el aviso legal corporativo indicando que alerts@cscloudsolutions.com.ar es no-reply
 * y derivando las consultas a soporte@cscloudsolutions.com.ar de forma profesional y formal.
 */
export function getNoReplyDisclaimer(locale: string = "es"): string {
  const loc = (locale || "es").toLowerCase();
  if (loc.startsWith("en")) {
    return "Automated send-only mailbox notice: The alerts@cscloudsolutions.com.ar account is a send-only mailbox dedicated exclusively to system notifications. This mailbox is unmonitored and cannot receive incoming messages; please do not reply directly to this email. For technical support, assistance, or inquiries, please reach out to soporte@cscloudsolutions.com.ar.";
  }
  if (loc.startsWith("pt")) {
    return "Aviso de caixa postal automática e exclusiva para envio: A conta alerts@cscloudsolutions.com.ar é uma caixa postal exclusiva para envio de notificações do sistema, não sendo monitorada para recebimento de mensagens. Por favor, não responda a este e-mail. Para suporte técnico, dúvidas ou assistência, entre em contato através de soporte@cscloudsolutions.com.ar.";
  }
  return "Aviso de casilla automática de solo envío: La cuenta alerts@cscloudsolutions.com.ar es una casilla de distribución automatizada y de solo envío para notificaciones del sistema. Este buzón no es monitoreado ni admite recepción de correos entrantes; por favor, no responda a este mensaje. Para asistencia técnica, soporte o consultas, contáctenos en soporte@cscloudsolutions.com.ar.";
}

export function getAlertTestEmailHtml(params: {
  ruleName: string;
  alertType: string;
  scopeType: string;
  scopeValue: string;
  threshold: string;
  testedAt: string;
  locale?: string;
}): string {
  const { ruleName, alertType, scopeType, scopeValue, threshold, testedAt, locale = "es" } = params;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://finops.cscloudsolutions.com.ar";
  const loc = (locale || "es").toLowerCase();
  const alertSender = process.env.AZURE_SENDER_EMAIL_ALERTS || process.env.AZURE_SENDER_EMAIL || "alerts@cscloudsolutions.com.ar";

  const i18n = loc.startsWith("en")
    ? {
        headerTitle: "Azure FinOps Platform",
        headerSubtitle: "CSCloudSolutions · Cloud Financial Operations",
        badge: "Delivery Verification",
        alertHeading: "System Alert Test Dispatched",
        leadText: `An automated alert test notification has been successfully dispatched for rule <strong>"${ruleName}"</strong> from the Self-Service Alerts control center.`,
        ruleLabel: "Alert Rule",
        typeLabel: "Detection Type",
        scopeLabel: "Monitored Scope",
        thresholdLabel: "Trigger Threshold",
        channelLabel: "Notification Channel",
        channelValue: "Email Notification (EMAIL)",
        senderLabel: "Sender Mailbox",
        dateLabel: "Timestamp (UTC)",
        verifiedBannerTitle: "Delivery Channel Confirmed",
        verifiedBannerBody: "Your mailbox credentials and Microsoft Graph API application permissions (<code>Mail.Send</code>) are properly configured, authenticated, and ready for production alerts.",
        ctaButton: "Open Alerts Console",
        disclaimerTitle: "Automated Send-Only Address",
        disclaimerBody: "The alerts@cscloudsolutions.com.ar account is a send-only mailbox dedicated exclusively to system notifications. This mailbox is unmonitored and cannot receive incoming messages; please do not reply directly to this email. For technical support, assistance, or inquiries, please reach out to soporte@cscloudsolutions.com.ar.",
        rightsReserved: "All rights reserved.",
        autoGeneratedNote: "This message was generated automatically by the FinOps alert verification engine.",
        supportLabel: "Technical Support",
      }
    : loc.startsWith("pt")
    ? {
        headerTitle: "Plataforma Azure FinOps",
        headerSubtitle: "CSCloudSolutions · Gestão Financeira na Nuvem",
        badge: "Verificação de Entrega",
        alertHeading: "Teste de Alerta do Sistema Disparado",
        leadText: `Uma notificação de teste automatizada foi enviada com sucesso para a regra <strong>"${ruleName}"</strong> a partir da central de Alertas Self-Service.`,
        ruleLabel: "Regra de Alerta",
        typeLabel: "Tipo de Detecção",
        scopeLabel: "Escopo Monitorado",
        thresholdLabel: "Limite Configurado",
        channelLabel: "Canal de Notificação",
        channelValue: "Correio Eletrônico (EMAIL)",
        senderLabel: "Caixa Emissora",
        dateLabel: "Data e Hora (UTC)",
        verifiedBannerTitle: "Canal de Entrega Confirmado",
        verifiedBannerBody: "As credenciais da sua caixa postal e as permissões de aplicativo do Microsoft Graph (<code>Mail.Send</code>) estão configuradas, autenticadas e operacionais para produção.",
        ctaButton: "Acessar Painel de Alertas",
        disclaimerTitle: "Caixa Automática Exclusiva para Envio",
        disclaimerBody: "A conta alerts@cscloudsolutions.com.ar é uma caixa postal exclusiva para envio de notificações do sistema, não sendo monitorada para recebimento de mensagens. Por favor, não responda a este e-mail. Para suporte técnico, dúvidas ou assistência, entre em contato através de soporte@cscloudsolutions.com.ar.",
        rightsReserved: "Todos os direitos reservados.",
        autoGeneratedNote: "Esta mensagem foi gerada automaticamente pelo motor de verificação de alertas FinOps.",
        supportLabel: "Suporte Técnico",
      }
    : {
        headerTitle: "Plataforma Azure FinOps",
        headerSubtitle: "CSCloudSolutions · Gestión Financiera Cloud",
        badge: "Verificación de Entrega",
        alertHeading: "Prueba de Alerta de Sistema Despachada",
        leadText: `Se ha ejecutado y validado exitosamente una prueba automatizada de entrega para la regla de alerta <strong>"${ruleName}"</strong> desde el panel de Alertas Self-Service.`,
        ruleLabel: "Regla de Alerta",
        typeLabel: "Tipo de Detección",
        scopeLabel: "Alcance Monitoreado",
        thresholdLabel: "Umbral de Disparo",
        channelLabel: "Canal de Notificación",
        channelValue: "Correo Electrónico (EMAIL)",
        senderLabel: "Casilla Emisora",
        dateLabel: "Fecha y Hora (UTC)",
        verifiedBannerTitle: "Canal de Entrega Confirmado",
        verifiedBannerBody: "Las credenciales de tu buzón y los permisos de aplicación de Microsoft Graph (<code>Mail.Send</code>) están correctamente configurados, autenticados y listos para alertas en producción.",
        ctaButton: "Ir a la Consola de Alertas",
        disclaimerTitle: "Casilla Automática de Solo Envío",
        disclaimerBody: "La cuenta alerts@cscloudsolutions.com.ar es una casilla de distribución automatizada y de solo envío para notificaciones del sistema. Este buzón no es monitoreado ni admite recepción de correos entrantes; por favor, no responda a este mensaje. Para asistencia técnica, soporte o consultas, contáctenos en soporte@cscloudsolutions.com.ar.",
        rightsReserved: "Todos los derechos reservados.",
        autoGeneratedNote: "Este mensaje fue generado automáticamente por el motor de verificación de alertas FinOps.",
        supportLabel: "Soporte Técnico",
      };

  return `
    <!DOCTYPE html>
    <html lang="${loc}">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
          .email-wrapper { width: 100%; background-color: #f1f5f9; padding: 32px 12px; }
          .email-card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.05); }
          .header { background: linear-gradient(135deg, #0054A6 0%, #002D62 100%); padding: 32px 36px; text-align: left; }
          .brand-title { margin: 0; font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em; }
          .brand-sub { margin: 6px 0 0 0; font-size: 11px; font-weight: 600; color: #93c5fd; text-transform: uppercase; letter-spacing: 0.08em; }
          .content { padding: 36px 36px 28px 36px; }
          .pill-badge { display: inline-block; padding: 5px 12px; font-size: 11px; font-weight: 700; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.05em; background-color: #e0f2fe; color: #0284c7; border: 1px solid #bae6fd; margin-bottom: 16px; }
          .lead-heading { margin: 0 0 10px 0; font-size: 19px; font-weight: 700; color: #0f172a; letter-spacing: -0.01em; line-height: 1.3; }
          .lead-text { margin: 0 0 22px 0; font-size: 14px; line-height: 1.6; color: #475569; }
          .summary-card { background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 22px; margin: 20px 0 24px 0; }
          .detail-table { width: 100%; border-collapse: collapse; }
          .detail-table td { padding: 10px 0; border-bottom: 1px solid #edf2f7; font-size: 13px; }
          .detail-table tr:last-child td { border-bottom: none; }
          .label { color: #64748b; font-weight: 600; width: 38%; }
          .value { color: #0f172a; font-weight: 500; }
          .highlight { font-weight: 700; color: #0054A6; }
          .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
          .banner { background-color: #f0fdf4; border: 1px solid #bbf7d0; border-left: 4px solid #16a34a; padding: 14px 18px; border-radius: 6px; font-size: 13px; color: #15803d; margin: 20px 0; line-height: 1.5; }
          .banner-title { font-weight: 700; margin-bottom: 4px; display: block; }
          .disclaimer-card { background-color: #fffbeb; border: 1px solid #fef3c7; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 16px 20px; font-size: 12px; color: #92400e; margin: 24px 0 16px 0; line-height: 1.6; }
          .disclaimer-title { font-weight: 700; font-size: 13px; color: #78350f; margin-bottom: 6px; }
          .cta-wrapper { margin-top: 28px; text-align: left; }
          .cta-button { display: inline-block; padding: 12px 28px; background: linear-gradient(135deg, #0054A6 0%, #003e7e 100%); color: #ffffff !important; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: 600; box-shadow: 0 2px 6px rgba(0, 84, 166, 0.25); }
          .footer { background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px 36px; font-size: 11px; color: #94a3b8; text-align: center; line-height: 1.6; }
          .footer p { margin: 0 0 6px 0; }
          .footer a { color: #0054A6; text-decoration: underline; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="email-wrapper">
          <div class="email-card">
            <div class="header">
              <h1 class="brand-title">☁️ ${i18n.headerTitle}</h1>
              <p class="brand-sub">${i18n.headerSubtitle}</p>
            </div>
            <div class="content">
              <span class="pill-badge">${i18n.badge}</span>
              <h2 class="lead-heading">${i18n.alertHeading}</h2>
              <p class="lead-text">${i18n.leadText}</p>
              
              <div class="summary-card">
                <table class="detail-table">
                  <tr>
                    <td class="label">${i18n.ruleLabel}</td>
                    <td class="value highlight">${ruleName}</td>
                  </tr>
                  <tr>
                    <td class="label">${i18n.typeLabel}</td>
                    <td class="value">${alertType}</td>
                  </tr>
                  <tr>
                    <td class="label">${i18n.scopeLabel}</td>
                    <td class="value">${scopeType}: ${scopeValue || "Tenant"}</td>
                  </tr>
                  <tr>
                    <td class="label">${i18n.thresholdLabel}</td>
                    <td class="value highlight">${threshold}</td>
                  </tr>
                  <tr>
                    <td class="label">${i18n.channelLabel}</td>
                    <td class="value">${i18n.channelValue}</td>
                  </tr>
                  <tr>
                    <td class="label">${i18n.senderLabel}</td>
                    <td class="value font-mono">${alertSender}</td>
                  </tr>
                  <tr>
                    <td class="label">${i18n.dateLabel}</td>
                    <td class="value">${testedAt}</td>
                  </tr>
                </table>
              </div>

              <div class="banner">
                <span class="banner-title">✅ ${i18n.verifiedBannerTitle}</span>
                ${i18n.verifiedBannerBody}
              </div>

              <div class="disclaimer-card">
                <div class="disclaimer-title">⚠️ ${i18n.disclaimerTitle}</div>
                <div>${i18n.disclaimerBody}</div>
              </div>

              <div class="cta-wrapper">
                <a href="${baseUrl}/governance/alerts" class="cta-button">${i18n.ctaButton} &rarr;</a>
              </div>
            </div>

            <div class="footer">
              <p>© 2026 CSCloudSolutions · Cloud Financial Management. ${i18n.rightsReserved}</p>
              <p>${i18n.autoGeneratedNote}</p>
              <p>${i18n.supportLabel}: <a href="mailto:soporte@cscloudsolutions.com.ar">soporte@cscloudsolutions.com.ar</a></p>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Plantilla HTML corporativa estándar para cualquier alerta despachada por correo a los tenants.
 * Garantiza consistencia visual, badge de severidad, tarjeta de datos y aviso no-reply formal.
 */
export function getStandardAlertNotificationEmailHtml(params: {
  title: string;
  message: string;
  severity?: "info" | "warning" | "error";
  link?: string;
  locale?: string;
  metadata?: Record<string, unknown>;
}): string {
  const { title, message, severity = "info", link, locale = "es", metadata } = params;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://finops.cscloudsolutions.com.ar";
  const loc = (locale || "es").toLowerCase();
  const alertSender = process.env.AZURE_SENDER_EMAIL_ALERTS || process.env.AZURE_SENDER_EMAIL || "alerts@cscloudsolutions.com.ar";
  const disclaimerText = getNoReplyDisclaimer(loc);

  const badgeColor =
    severity === "error"
      ? { bg: "#fee2e2", text: "#991b1b", border: "#fecaca", label: loc.startsWith("en") ? "Critical Alert" : loc.startsWith("pt") ? "Alerta Crítico" : "Alerta Crítico", icon: "🚨" }
      : severity === "warning"
      ? { bg: "#fef3c7", text: "#92400e", border: "#fde68a", label: loc.startsWith("en") ? "Warning" : loc.startsWith("pt") ? "Aviso" : "Advertencia", icon: "⚠️" }
      : { bg: "#e0f2fe", text: "#0369a1", border: "#bae6fd", label: loc.startsWith("en") ? "Information" : loc.startsWith("pt") ? "Informativo" : "Informativo", icon: "ℹ️" };

  const ctaTitle = loc.startsWith("en") ? "View in FinOps Platform" : loc.startsWith("pt") ? "Ver no Painel FinOps" : "Ver en la Plataforma FinOps";
  const disclaimerTitle = loc.startsWith("en") ? "Automated Send-Only Address" : loc.startsWith("pt") ? "Caixa Automática Exclusiva para Envio" : "Casilla Automática de Solo Envío";
  const supportLabel = loc.startsWith("en") ? "Technical Support" : loc.startsWith("pt") ? "Suporte Técnico" : "Soporte Técnico";

  const metaRows = metadata && Object.keys(metadata).length > 0
    ? Object.entries(metadata)
        .filter(([k]) => k !== "disclaimer")
        .map(([k, v]) => {
          const val = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
          return `<tr><td style="color:#64748b;font-weight:600;padding:8px 0;border-bottom:1px solid #edf2f7;font-size:13px;width:38%;">${k}</td><td style="color:#0f172a;padding:8px 0;border-bottom:1px solid #edf2f7;font-size:13px;">${val}</td></tr>`;
        })
        .join("")
    : "";

  return `
    <!DOCTYPE html>
    <html lang="${loc}">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
        <div style="width:100%;background-color:#f1f5f9;padding:32px 12px;">
          <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 4px 20px -2px rgba(0,0,0,0.05);">
            <div style="background:linear-gradient(135deg, #0054A6 0%, #002D62 100%);padding:28px 36px;text-align:left;">
              <h1 style="margin:0;font-size:20px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">☁️ Azure FinOps Platform</h1>
              <p style="margin:6px 0 0 0;font-size:11px;font-weight:600;color:#93c5fd;text-transform:uppercase;letter-spacing:0.08em;">CSCloudSolutions · Cloud Financial Operations</p>
            </div>
            <div style="padding:36px 36px 28px 36px;">
              <span style="display:inline-block;padding:5px 12px;font-size:11px;font-weight:700;border-radius:9999px;text-transform:uppercase;letter-spacing:0.05em;background-color:${badgeColor.bg};color:${badgeColor.text};border:1px solid ${badgeColor.border};margin-bottom:16px;">
                ${badgeColor.icon} ${badgeColor.label}
              </span>
              <h2 style="margin:0 0 12px 0;font-size:19px;font-weight:700;color:#0f172a;line-height:1.3;">${title}</h2>
              <div style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 20px 0;white-space:pre-line;">${message}</div>

              ${metaRows ? `
              <div style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 20px;margin:20px 0;">
                <table style="width:100%;border-collapse:collapse;">
                  ${metaRows}
                </table>
              </div>` : ""}

              ${link ? `
              <div style="margin:24px 0;">
                <a href="${link}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg, #0054A6 0%, #003e7e 100%);color:#ffffff !important;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;box-shadow:0 2px 6px rgba(0,84,166,0.25);">${ctaTitle} &rarr;</a>
              </div>` : ""}

              <div style="background-color:#fffbeb;border:1px solid #fef3c7;border-left:4px solid #f59e0b;border-radius:8px;padding:16px 20px;font-size:12px;color:#92400e;margin:26px 0 16px 0;line-height:1.6;">
                <div style="font-weight:700;font-size:13px;color:#78350f;margin-bottom:6px;">⚠️ ${disclaimerTitle}</div>
                <div>${disclaimerText}</div>
              </div>
            </div>

            <div style="background-color:#f8fafc;border-top:1px solid #e2e8f0;padding:24px 36px;font-size:11px;color:#94a3b8;text-align:center;line-height:1.6;">
              <p style="margin:0 0 6px 0;">© 2026 CSCloudSolutions · Cloud Financial Management. All rights reserved.</p>
              <p style="margin:0;">${supportLabel}: <a href="mailto:soporte@cscloudsolutions.com.ar" style="color:#0054A6;text-decoration:underline;font-weight:600;">soporte@cscloudsolutions.com.ar</a></p>
            </div>
          </div>
        </div>
      </body>
  `;
}

export function getWelcomeEmailHtml(userEmail: string, companyName: string, planName: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://finops.example.com';
  
  return `
    <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #0054A6 0%, #003d7a 100%); color: white; padding: 40px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; border: 1px solid #e0e0e0; border-radius: 0 0 8px 8px; padding: 40px; }
          .button { display: inline-block; padding: 12px 32px; background-color: #0054A6; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 20px; }
          .footer { text-align: center; font-size: 12px; color: #666; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Welcome to FinOps SaaS!</h1>
          </div>
          <div class="content">
            <p>Hi there,</p>
            <p>Welcome to FinOps SaaS! Your 7-day free trial has started, and we're excited to help you optimize your Azure cloud costs.</p>
            
            <h2>Your Trial Includes:</h2>
            <ul>
              <li>✅ Full access to <strong>${planName}</strong> plan features</li>
              <li>✅ Real-time Azure cost analysis and recommendations</li>
              <li>✅ 7 days to explore all features at no cost</li>
              <li>✅ No credit card required</li>
            </ul>
            
            <h2>What's Next?</h2>
            <ol>
              <li>Connect your Azure subscription (if not already done)</li>
              <li>Explore your cost analytics dashboard</li>
              <li>Review FinOps recommendations tailored to your infrastructure</li>
            </ol>
            
            <p style="margin-top: 30px;">
              <a href="${baseUrl}/es" class="button">Go to Dashboard</a>
            </p>
            
            <p style="margin-top: 30px; color: #666; font-size: 14px;">
              If you have any questions or need help getting started, our support team is here to assist you at <strong>soporte@cscloudsolutions.com.ar</strong>
            </p>
          </div>
          <div class="footer">
            <p>© 2026 CSCloudSolutions. All rights reserved.</p>
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

export function getTrialReminderEmailHtml(daysLeft: number): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://finops.example.com';
  
  return `
    <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 40px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; border: 1px solid #e0e0e0; border-radius: 0 0 8px 8px; padding: 40px; }
          .button { display: inline-block; padding: 12px 32px; background-color: #f59e0b; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 20px; }
          .footer { text-align: center; font-size: 12px; color: #666; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>⏰ Your Trial is Ending Soon</h1>
          </div>
          <div class="content">
            <p>Hi there,</p>
            <p><strong>You have ${daysLeft} days left</strong> in your FinOps SaaS trial!</p>
            
            <p>Don't miss out on:</p>
            <ul>
              <li>💰 Continued cost optimization recommendations</li>
              <li>📊 Real-time Azure analytics</li>
              <li>🎯 Automated governance policies</li>
            </ul>
            
            <p style="margin-top: 30px;">
              <a href="${baseUrl}/pricing" class="button">Choose Your Plan</a>
            </p>
            
            <p style="margin-top: 30px; color: #666; font-size: 14px;">
              Have questions? Contact us at <strong>soporte@cscloudsolutions.com.ar</strong>
            </p>
          </div>
          <div class="footer">
            <p>© 2026 CSCloudSolutions. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

export function getTrialExpiredEmailHtml(): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://finops.example.com';
  
  return `
    <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; padding: 40px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; border: 1px solid #e0e0e0; border-radius: 0 0 8px 8px; padding: 40px; }
          .button { display: inline-block; padding: 12px 32px; background-color: #ef4444; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 20px; }
          .footer { text-align: center; font-size: 12px; color: #666; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📅 Your Trial Has Ended</h1>
          </div>
          <div class="content">
            <p>Hi there,</p>
            <p>Your 7-day free trial has ended. To continue using FinOps SaaS and keep your data, please upgrade to a paid plan.</p>
            
            <p style="margin-top: 30px;">
              <a href="${baseUrl}/pricing" class="button">Upgrade Now</a>
            </p>
            
            <p style="margin-top: 30px; color: #666; font-size: 14px;">
              Questions? Reach out to <strong>soporte@cscloudsolutions.com.ar</strong> or contact our sales team at <strong>sales@cscloudsolutions.com.ar</strong>
            </p>
          </div>
          <div class="footer">
            <p>© 2026 CSCloudSolutions. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

export function getSubscriptionEndedEmailHtml(): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://finops.example.com';

  return `
    <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; padding: 40px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; border: 1px solid #e0e0e0; border-radius: 0 0 8px 8px; padding: 40px; }
          .button { display: inline-block; padding: 12px 32px; background-color: #ef4444; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 20px; }
          .footer { text-align: center; font-size: 12px; color: #666; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>📅 Tu acceso a FinOps SaaS finalizó</h1>
          </div>
          <div class="content">
            <p>Hola,</p>
            <p>Tu suscripción fue cancelada y el período que ya tenías pagado terminó, así que tu acceso a la plataforma quedó suspendido. Tus datos se conservan — si querés reactivar el servicio en cualquier momento, podés volver a suscribirte.</p>

            <p style="margin-top: 30px;">
              <a href="${baseUrl}/pricing" class="button">Reactivar plan</a>
            </p>

            <p style="margin-top: 30px; color: #666; font-size: 14px;">
              ¿Preguntas? Escribinos a <strong>soporte@cscloudsolutions.com.ar</strong> o a nuestro equipo comercial en <strong>sales@cscloudsolutions.com.ar</strong>
            </p>
          </div>
          <div class="footer">
            <p>© 2026 CSCloudSolutions. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Alerta INTERNA (equipo CSCloudSolutions, no el cliente) cuando un tenant
 * cancela su suscripción — cualquiera sea el canal (Paddle o Azure
 * Marketplace). Notifica cuánto acceso le queda todavía, para que ventas/
 * customer success pueda intentar retenerlo antes de que se corte.
 */
export function getInternalCancellationAlertEmailHtml(params: {
  tenantId: string;
  companyName: string | null;
  tier: string | null;
  source: string;
  accessUntil: Date | null;
  adminEmail: string | null;
}): string {
  const { tenantId, companyName, tier, source, accessUntil, adminEmail } = params;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://finops.example.com';
  const accessUntilText = accessUntil
    ? accessUntil.toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'sin fecha exacta (depende del ciclo de facturación del marketplace)';

  return `
    <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #b45309 0%, #92400e 100%); color: white; padding: 32px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; border: 1px solid #e0e0e0; border-radius: 0 0 8px 8px; padding: 32px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          td { padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; }
          td:first-child { color: #666; width: 160px; }
          .button { display: inline-block; padding: 10px 24px; background-color: #b45309; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 20px; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin:0;font-size:20px;">⚠️ Cancelación de suscripción</h1>
          </div>
          <div class="content">
            <table>
              <tr><td>Cliente</td><td><strong>${companyName || '(sin nombre)'}</strong></td></tr>
              <tr><td>Tenant ID</td><td style="font-family:monospace;">${tenantId}</td></tr>
              <tr><td>Plan</td><td>${tier || '(desconocido)'}</td></tr>
              <tr><td>Canal</td><td>${source}</td></tr>
              <tr><td>Admin de cuenta</td><td>${adminEmail || '(sin email registrado)'}</td></tr>
              <tr><td>Acceso hasta</td><td><strong>${accessUntilText}</strong></td></tr>
            </table>
            <p style="margin-top:24px;">El cliente conserva acceso a la plataforma hasta la fecha indicada; después se revoca automáticamente. Si corresponde, contactalo antes de esa fecha para intentar retenerlo.</p>
            <p style="margin-top: 20px;">
              <a href="${baseUrl}/admin/tenants" class="button">Ver tenant en Admin</a>
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Alerta INTERNA (equipo CSCloudSolutions, no el cliente) cuando se completa
 * un signup real — nuevo tenant/usuario provisionado con trial activo. El
 * cliente recibe por separado el email de bienvenida (getWelcomeEmailHtml);
 * esta es la notificación paralela para que soporte/ventas haga seguimiento.
 */
export function getInternalSignupAlertEmailHtml(params: {
  tenantId: string;
  companyName: string | null;
  tier: string;
  userEmail: string;
  trialEndsAt: string | null;
}): string {
  const { tenantId, companyName, tier, userEmail, trialEndsAt } = params;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://finops.example.com';
  const trialEndsText = trialEndsAt
    ? new Date(trialEndsAt).toLocaleDateString('es-AR', { year: 'numeric', month: 'long', day: 'numeric' })
    : '(sin trial)';

  return `
    <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #0054A6 0%, #003d7a 100%); color: white; padding: 32px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; border: 1px solid #e0e0e0; border-radius: 0 0 8px 8px; padding: 32px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          td { padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; }
          td:first-child { color: #666; width: 160px; }
          .button { display: inline-block; padding: 10px 24px; background-color: #0054A6; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 20px; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin:0;font-size:20px;">🆕 Nuevo signup en FinOps SaaS</h1>
          </div>
          <div class="content">
            <table>
              <tr><td>Cliente</td><td><strong>${companyName || '(sin nombre)'}</strong></td></tr>
              <tr><td>Tenant ID</td><td style="font-family:monospace;">${tenantId}</td></tr>
              <tr><td>Usuario (Admin)</td><td>${userEmail}</td></tr>
              <tr><td>Plan</td><td>${tier}</td></tr>
              <tr><td>Trial termina</td><td><strong>${trialEndsText}</strong></td></tr>
            </table>
            <p style="margin-top: 20px;">
              <a href="${baseUrl}/admin/tenants" class="button">Ver tenant en Admin</a>
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Alerta INTERNA de sistema (equipo CSCloudSolutions) cuando una prueba de
 * carga (o el runtime) detecta latencia/tasa de error por encima del umbral
 * — ver src/lib/loadTester.ts. Solo severidad 'critical' dispara email; los
 * 'warning' quedan solo en la tabla SystemAlerts, que hoy no tiene pantalla
 * propia: la ruta /admin/system-alerts se eliminó porque renderizaba el panel
 * de pruebas de carga, no un panel de alertas.
 */
export function getCriticalSystemAlertEmailHtml(params: {
  message: string;
  source: string;
  detail?: Record<string, unknown>;
}): string {
  const { message, source, detail } = params;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://finops.example.com';
  const detailRows = detail
    ? Object.entries(detail).map(([k, v]) => {
        const formattedVal = typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v);
        return `<tr><td style="vertical-align:top;">${k}</td><td><pre style="margin:0;font-family:monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;">${formattedVal}</pre></td></tr>`;
      }).join('')
    : '';

  return `
    <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #b91c1c 0%, #7f1d1d 100%); color: white; padding: 32px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; border: 1px solid #e0e0e0; border-radius: 0 0 8px 8px; padding: 32px; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          td { padding: 8px 0; border-bottom: 1px solid #eee; font-size: 14px; }
          td:first-child { color: #666; width: 160px; }
          .button { display: inline-block; padding: 10px 24px; background-color: #b91c1c; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 20px; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin:0;font-size:20px;">🚨 Alerta crítica de sistema</h1>
          </div>
          <div class="content">
            <p style="font-size:15px;"><strong>${message}</strong></p>
            <table>
              <tr><td>Origen</td><td>${source}</td></tr>
              ${detailRows}
            </table>
            <p style="margin-top: 20px;">
              <a href="${baseUrl}/admin/system-alerts" class="button">Ver Alertas del Sistema</a>
            </p>
          </div>
        </div>
      </body>
    </html>
  `;
}

/**
 * Envoltorio compartido de las plantillas de auth local (Fase 2). Mismo estilo
 * visual que getWelcomeEmailHtml, sin repetir el bloque de CSS en cada una.
 *
 * Estos mails llevan un link de un solo uso, así que el texto avisa
 * explícitamente qué hacer si el destinatario NO pidió la acción — es la
 * única defensa del usuario cuando alguien tipea mal su email en el signup.
 */
function getAuthEmailShell(title: string, bodyHtml: string): string {
  return `
    <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #0054A6 0%, #003d7a 100%); color: white; padding: 40px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: white; border: 1px solid #e0e0e0; border-radius: 0 0 8px 8px; padding: 40px; }
          .button { display: inline-block; padding: 12px 32px; background-color: #0054A6; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 20px; }
          .fallback { word-break: break-all; color: #666; font-size: 12px; margin-top: 24px; }
          .footer { text-align: center; font-size: 12px; color: #666; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header"><h1>${title}</h1></div>
          <div class="content">${bodyHtml}</div>
          <div class="footer">
            <p>© 2026 CSCloudSolutions. All rights reserved.</p>
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

export function getVerifyEmailHtml(verifyUrl: string): string {
  return getAuthEmailShell('Confirmá tu email', `
    <p>Hola,</p>
    <p>Alguien creó una cuenta en CSCloudSolutions con esta dirección. Confirmala para poder iniciar sesión.</p>
    <p><a href="${verifyUrl}" class="button">Confirmar mi email</a></p>
    <p class="fallback">Si el botón no funciona, copiá y pegá este link en tu navegador:<br>${verifyUrl}</p>
    <p style="margin-top: 24px; color: #666; font-size: 14px;">
      El link vence en 24 horas. <strong>Si no creaste ninguna cuenta, ignorá este mensaje</strong> —
      sin confirmar, la cuenta no puede usarse.
    </p>
  `);
}

export function getPasswordResetEmailHtml(resetUrl: string): string {
  return getAuthEmailShell('Restablecer tu contraseña', `
    <p>Hola,</p>
    <p>Recibimos un pedido para restablecer la contraseña de tu cuenta de CSCloudSolutions.</p>
    <p><a href="${resetUrl}" class="button">Elegir una contraseña nueva</a></p>
    <p class="fallback">Si el botón no funciona, copiá y pegá este link en tu navegador:<br>${resetUrl}</p>
    <p style="margin-top: 24px; color: #666; font-size: 14px;">
      El link vence en 1 hora y sirve una sola vez. <strong>Si no pediste esto, ignorá el mensaje</strong>:
      tu contraseña actual sigue funcionando y nadie accedió a tu cuenta.
    </p>
  `);
}

export function getInviteEmailHtml(inviteUrl: string): string {
  return getAuthEmailShell('Te invitaron a CSCloudSolutions', `
    <p>Hola,</p>
    <p>Un administrador de tu organización te dio acceso a la plataforma de FinOps de CSCloudSolutions.
       Para entrar sólo tenés que elegir una contraseña.</p>
    <p><a href="${inviteUrl}" class="button">Activar mi cuenta</a></p>
    <p class="fallback">Si el botón no funciona, copiá y pegá este link en tu navegador:<br>${inviteUrl}</p>
    <p style="margin-top: 24px; color: #666; font-size: 14px;">
      El link vence en 7 días y sirve una sola vez. Vas a entrar con permisos de solo lectura;
      si necesitás más, pedíselo a quien te invitó.
    </p>
  `);
}
