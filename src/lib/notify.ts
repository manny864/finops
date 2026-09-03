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
    /**
     * MEJ-33 paso 3: a quién va dirigido. Omitirlo (o `null`) difunde a todo el
     * tenant, que es el comportamiento histórico y el correcto para un aviso de
     * plataforma. Sólo lo que tiene dueño identificable se dirige — un aviso
     * que le llega a todos es un aviso que nadie toma.
     */
    userEmail?: string | null;
}): Promise<void> {
    try {
        await pool.query(
            `INSERT INTO Notifications (tenant_id, title, message, href, severity, source, user_email) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [params.tenantId, params.title, params.message, params.href || null, params.severity || "info", params.source, params.userEmail || null]
        );
    } catch (e) {
        // Nunca debe romper el flujo de alerta principal (email/webhook) por un
        // fallo al persistir la notificación in-app.
        console.error("[notify] createNotification failed:", (e as Error)?.message || e);
    }
}
