import type { ResultSetHeader, RowDataPacket } from "mysql2";
import pool from "@/modules/storage/db";
import { isMockTenant } from "@/lib/mockData";
import { hasAccess } from "@/lib/tierLogic";
import { getRequiredTierForPath } from "@/lib/routeTiers";
import { addonUnlocksPath } from "@/lib/addonCatalog";
import { errorMessage } from "@/lib/apiErrors";
import { createNotification } from "@/lib/notify";
import { notifyTenant } from "@/lib/notifications";
import { TenantAddonsService } from "@/services/tenantAddons.service";
import { diasHastaVencer, escalonPara, type Escalon } from "@/services/reservationExpiryAlerts.service";

/**
 * Avisos de renovación de `Commitments` con la misma escalera que las reservas
 * (`reservationExpiryAlerts.service.ts`): 90, 60 y 30 días, por escalón y no
 * por día exacto, con un registro (`CommitmentRenewalNotices`) para que cada
 * escalón se avise una vez.
 *
 * Lo que se vigila no es el fin del compromiso sino la FECHA LÍMITE DEL
 * PREAVISO: la renovación (o el fin) menos los días de preaviso. Pasada esa
 * fecha ya no se puede cancelar ni renegociar.
 */

/** La pantalla donde se cargan; el aviso lleva ahí. */
export const COMMITMENTS_PAGE = "/intelligence/external-spend";

export interface CommitmentRenewalNotice {
    commitmentId: number;
    vendorName: string;
    /** `YYYY-MM-DD`. */
    deadline: string;
    days: number;
    threshold: Escalon;
    autoRenew: boolean;
}

export function renewalNotices(
    rows: Array<{ commitmentId: number; vendorName: string; deadline: string; autoRenew: boolean }>,
    today: Date,
): CommitmentRenewalNotice[] {
    const notices: CommitmentRenewalNotice[] = [];
    for (const r of rows) {
        const days = diasHastaVencer(r.deadline, today);
        const threshold = escalonPara(days);
        if (threshold !== null) notices.push({ ...r, days, threshold });
    }
    return notices.sort((a, b) => a.days - b.days);
}

/** Por el escalón más cercano: con o sin renovación automática, la fecha límite no se mueve. */
export function renewalSeverity(notices: CommitmentRenewalNotice[]): "info" | "warning" | "critical" {
    const nearest = Math.min(...notices.map((n) => n.threshold));
    return nearest === 30 ? "critical" : nearest === 60 ? "warning" : "info";
}

/** Texto de respaldo en castellano para email, Slack y Teams; la campanita usa sus claves. */
export function renewalNoticeText(notices: CommitmentRenewalNotice[]): { title: string; message: string } {
    const n = notices.length;
    const title = `📝 ${n} ${n === 1 ? "compromiso con proveedores tiene" : "compromisos con proveedores tienen"} fecha límite de preaviso en los próximos ${notices[n - 1].threshold} días`;
    const lines = notices.slice(0, 15).map((c) => {
        const when = c.days === 0 ? "vence hoy" : `vence el ${c.deadline} (en ${c.days} ${c.days === 1 ? "día" : "días"})`;
        return `• ${c.vendorName} — el preaviso ${when} · ${c.autoRenew ? "se renueva solo" : "SIN renovación automática"}`;
    });
    if (n > 15) lines.push(`… y ${n - 15} más.`);
    lines.push("", "Pasada esa fecha ya no se puede cancelar ni renegociar la renovación.");
    return { title, message: lines.join("\n") };
}

/** Sólo avisa a quien tiene la pantalla: por plan o por el módulo comprado. */
async function hasScreen(tenantId: string, tier: string): Promise<boolean> {
    const required = getRequiredTierForPath(COMMITMENTS_PAGE);
    if (!required || hasAccess(tier, required)) return true;
    const active = await TenantAddonsService.getActiveAddons(tenantId);
    return addonUnlocksPath(active.map((a) => a.addonKey), COMMITMENTS_PAGE);
}

/**
 * Recorre los compromisos con fecha límite en los próximos 90 días y avisa los
 * escalones nuevos. INSERT IGNORE contra la clave primaria hace de candado: dos
 * corridas superpuestas no avisan dos veces lo mismo.
 */
export async function sendCommitmentRenewalAlerts(
    publicUrl: string,
    today = new Date(),
): Promise<{ evaluated: number; notified: number; errors: string[] }> {
    // La ventana del SQL es un día más ancha de cada lado; el escalón exacto lo
    // decide `renewalNotices` en UTC.
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT c.id, c.tenant_id, t.tier, c.vendor_name, c.auto_renew,
                DATE_FORMAT(DATE_SUB(COALESCE(c.renewal_date, c.end_date), INTERVAL c.notice_days DAY), '%Y-%m-%d') AS deadline
         FROM Commitments c JOIN Tenants t ON t.tenant_id = c.tenant_id
         WHERE t.subscription_status NOT IN ('CANCELED', 'EXPIRED')
           AND DATE_SUB(COALESCE(c.renewal_date, c.end_date), INTERVAL c.notice_days DAY)
               BETWEEN CURDATE() - INTERVAL 1 DAY AND CURDATE() + INTERVAL 91 DAY
         ORDER BY c.tenant_id
         LIMIT 5000`,
    );
    const byTenant = new Map<string, RowDataPacket[]>();
    for (const r of rows) byTenant.set(r.tenant_id, [...(byTenant.get(r.tenant_id) ?? []), r]);

    let evaluated = 0;
    let notified = 0;
    const errors: string[] = [];
    for (const [tenantId, list] of byTenant) {
        if (isMockTenant(tenantId)) continue;
        try {
            if (!(await hasScreen(tenantId, list[0].tier))) continue;
            evaluated++;
            const candidates = renewalNotices(
                list.map((r) => ({ commitmentId: Number(r.id), vendorName: r.vendor_name, deadline: r.deadline, autoRenew: Boolean(r.auto_renew) })),
                today,
            );
            const fresh: CommitmentRenewalNotice[] = [];
            for (const c of candidates) {
                const [res] = await pool.query<ResultSetHeader>(
                    "INSERT IGNORE INTO CommitmentRenewalNotices (commitment_id, deadline, threshold_days) VALUES (?, ?, ?)",
                    [c.commitmentId, c.deadline, c.threshold],
                );
                if (res.affectedRows === 1) fresh.push(c);
            }
            if (fresh.length === 0) continue;

            const { title, message } = renewalNoticeText(fresh);
            const severity = renewalSeverity(fresh);
            await createNotification({
                tenantId,
                title,
                message,
                titleKey: "notif_commitment_renewal_title",
                messageKey: "notif_commitment_renewal_msg",
                params: { count: fresh.length, days: fresh[0].days },
                href: COMMITMENTS_PAGE,
                severity,
                source: "commitment_renewal",
            });
            await notifyTenant(tenantId, {
                title,
                message,
                severity: severity === "critical" ? "error" : severity,
                link: `${publicUrl}${COMMITMENTS_PAGE}`,
            });
            notified++;
        } catch (e) {
            errors.push(`${tenantId}: ${errorMessage(e)}`);
        }
    }
    return { evaluated, notified, errors };
}
