import pool from "@/modules/storage/db";
import { sendEmailAsync, getInternalCancellationAlertEmailHtml } from "@/lib/emailHelper";

/**
 * Notifica al equipo interno de CSCloudSolutions cuando un tenant cancela
 * su suscripción, sin importar el canal (Paddle, AWS/Azure Marketplace).
 * Best-effort: nunca debe tirar abajo el webhook que la invoca si falla
 * (fire-and-forget vía sendEmailAsync, más try/catch acá).
 */
export async function notifyInternalCancellation(
  tenantId: string,
  source: "Paddle" | "AWS Marketplace" | "Azure Marketplace",
  accessUntil: Date | null
): Promise<void> {
  try {
    // Reusa el mismo destinatario interno que /api/leads (AZURE_RECIPIENT_EMAIL),
    // en vez de introducir una variable de entorno nueva para lo mismo.
    const alertEmail = process.env.INTERNAL_CANCELLATION_ALERT_EMAIL || process.env.AZURE_RECIPIENT_EMAIL || "ventas@cscloudsolutions.com.ar";

    const [rows]: any = await pool.query(
      `SELECT t.company_name, t.tier, u.email AS admin_email
       FROM Tenants t
       LEFT JOIN Users u ON t.tenant_id = u.tenant_id AND u.role IN ('Admin','Owner')
       WHERE t.tenant_id = ?
       LIMIT 1`,
      [tenantId]
    );
    const tenant = Array.isArray(rows) && rows[0] ? rows[0] : {};

    const html = getInternalCancellationAlertEmailHtml({
      tenantId,
      companyName: tenant.company_name || null,
      tier: tenant.tier || null,
      source,
      accessUntil,
      adminEmail: tenant.admin_email || null,
    });

    await sendEmailAsync(
      `Cancelación de suscripción — ${tenant.company_name || tenantId}`,
      html,
      alertEmail
    );
  } catch (err) {
    console.error("[billingAlerts] No se pudo enviar la alerta interna de cancelación:", err);
  }
}
