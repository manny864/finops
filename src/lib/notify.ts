import pool from "@/modules/storage/db";

export type NotificationSeverity = "info" | "warning" | "critical";

/**
 * Inserta una notificación en la bandeja genérica del tenant (tabla
 * Notifications). El hook useBrowserNotifications la consume por polling y
 * dispara una notificación real del navegador (Notification API) con link a
 * `href`. Todo feature que ya envía email/webhook por una alerta debería
 * llamar esto también, en el mismo punto donde dispara ese envío.
 */
export async function createNotification(params: {
    tenantId: string;
    title: string;
    message: string;
    href?: string;
    severity?: NotificationSeverity;
    source: string;
}): Promise<void> {
    try {
        await pool.query(
            `INSERT INTO Notifications (tenant_id, title, message, href, severity, source) VALUES (?, ?, ?, ?, ?, ?)`,
            [params.tenantId, params.title, params.message, params.href || null, params.severity || "info", params.source]
        );
    } catch (e) {
        // Nunca debe romper el flujo de alerta principal (email/webhook) por un
        // fallo al persistir la notificación in-app.
        console.error("[notify] createNotification failed:", (e as Error)?.message || e);
    }
}
