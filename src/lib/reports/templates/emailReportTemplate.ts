/**
 * emailReportTemplate.ts — Plantilla de Correo Electrónico Transaccional con CSS 100% Inlined
 * compatible con Microsoft Outlook Desktop, Apple Mail y Gmail.
 */
import type { EmailKpiItem } from '@/types/executiveReportExport.types';

export interface RenderEmailReportParams {
    tenantName: string;
    scopeDisplayName: string;
    generationDate: string;
    introMessage?: string;
    kpiHighlights: EmailKpiItem[];
    parsedContentHtml: string;
    reportUrl?: string;
}

export function renderEmailReportHtml(params: RenderEmailReportParams): string {
    const {
        tenantName,
        scopeDisplayName,
        generationDate,
        introMessage,
        kpiHighlights,
        parsedContentHtml,
        reportUrl = 'https://finops.cscloudsolutions.com.ar',
    } = params;

    const defaultIntro = `Le compartimos el Reporte Ejecutivo de FinOps correspondiente al período actual para <strong>${tenantName}</strong>, generado mediante inteligencia artificial sobre la telemetría viva de su infraestructura en Microsoft Azure. En el documento PDF adjunto encontrará el desglose pormenorizado de costos, ahorros proyectados y planes de remediación.`;

    const kpiCardsHtml = kpiHighlights
        .map(
            (kpi) => `
            <td style="width: 25%; padding: 8px; vertical-align: top;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center;">
                <tr>
                  <td style="font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; padding-bottom: 4px;">
                    ${kpi.label}
                  </td>
                </tr>
                <tr>
                  <td style="font-size: 16px; font-weight: 800; color: ${kpi.color || '#0054A6'}; font-family: 'Segoe UI', Arial, sans-serif;">
                    ${kpi.value}
                  </td>
                </tr>
                ${
                    kpi.subtext
                        ? `<tr><td style="font-size: 9px; color: #94a3b8; padding-top: 3px;">${kpi.subtext}</td></tr>`
                        : ''
                }
              </table>
            </td>
          `
        )
        .join('');

    return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reporte Ejecutivo FinOps · ${tenantName}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: 'Segoe UI', Helvetica, Arial, sans-serif; color: #0f172a; -webkit-font-smoothing: antialiased;">
  <center>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #f1f5f9; padding: 30px 10px;">
      <tr>
        <td align="center">
          <table cellpadding="0" cellspacing="0" border="0" width="640" style="max-width: 640px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); border: 1px solid #e2e8f0;">
            <!-- HEADER -->
            <tr>
              <td style="background-color: #0054A6; padding: 24px 32px; text-align: left;">
                <table cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td>
                      <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.3px;">
                        CSCloudSolutions <span style="font-weight: 400; opacity: 0.85;">· FinOps SaaS</span>
                      </h1>
                      <div style="color: #bfdbfe; font-size: 12px; margin-top: 4px;">
                        Reporte Ejecutivo de Gestión Cloud & Inteligencia Financiera
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- METADATA SUB-BAR -->
            <tr>
              <td style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0; padding: 12px 32px; font-size: 11px; color: #64748b;">
                <strong>Tenant:</strong> ${tenantName} &nbsp;|&nbsp; 
                <strong>Alcance:</strong> ${scopeDisplayName} &nbsp;|&nbsp; 
                <strong>Fecha:</strong> ${generationDate}
              </td>
            </tr>

            <!-- BODY CONTENT -->
            <tr>
              <td style="padding: 28px 32px;">
                <!-- INTRO BOX -->
                <div style="background-color: #f0f9ff; border-left: 4px solid #0078D4; padding: 14px 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px; font-size: 13px; line-height: 1.6; color: #0c4a6e;">
                  ${introMessage || defaultIntro}
                </div>

                <!-- 4 KPI CARDS TABLE -->
                <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 28px;">
                  <tr>
                    ${kpiCardsHtml}
                  </tr>
                </table>

                <!-- SÍNTESIS ESTRATÉGICA PARSEADA -->
                <div style="font-size: 13px; line-height: 1.65; color: #334155;">
                  ${parsedContentHtml}
                </div>

                <!-- CTA BUTTON -->
                <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e2e8f0; text-align: center;">
                  <a href="${reportUrl}" style="display: inline-block; background-color: #0054A6; color: #ffffff; text-decoration: none; padding: 12px 28px; font-size: 13px; font-weight: 700; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,84,166,0.2);">
                    Ver Reporte Completo en la Plataforma →
                  </a>
                </div>
              </td>
            </tr>

            <!-- FOOTER -->
            <tr>
              <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 32px; text-align: center; font-size: 11px; color: #94a3b8; line-height: 1.5;">
                © ${new Date().getFullYear()} CSCloudSolutions. Todos los derechos reservados.<br />
                Documento confidencial generado automáticamente con IA sobre datos vivos de Microsoft Azure.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </center>
</body>
</html>`;
}
