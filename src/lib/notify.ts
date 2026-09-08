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
    /**
     * Texto de respaldo, en castellano. **Sigue siendo obligatorio** y no es
     * redundante con `titleKey`: es lo que consumen los caminos que NO son la UI
     * localizada --el push del navegador, los webhooks, el email-- y es el
     * fallback si faltara la clave. Una fila de Notifications es permanente:
     * cuando se muestre dentro de un año, esto es lo unico seguro que hay.
     */
    title: string;
    message: string;
    /**
     * Claves i18n para la UI. Sin ellas la fila se muestra con `title`/`message`
     * tal cual, que es el comportamiento de las filas historicas.
     *
     * Van claves y no la frase traducida porque **la fila no expira**. Un payload
     * cacheado se rearma cuando vence; esto queda para siempre, asi que traducir
     * al insertar congela el idioma del momento en que ocurrio el evento.
     */
    titleKey?: string;
    messageKey?: string;
    /** Valores a interpolar en las dos claves. Numeros y nombres, nunca frases. */
    params?: Record<string, string | number>;
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
            `INSERT INTO Notifications (tenant_id, title, message, title_key, message_key, params_json, href, severity, source, user_email)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                params.tenantId,
                params.title,
                params.message,
                params.titleKey || null,
                params.messageKey || null,
                params.params ? JSON.stringify(params.params) : null,
                params.href || null,
                params.severity || "info",
                params.source,
                params.userEmail || null,
            ]
        );
    } catch (e) {
        // Nunca debe romper el flujo de alerta principal (email/webhook) por un
        // fallo al persistir la notificación in-app.
        console.error("[notify] createNotification failed:", (e as Error)?.message || e);
    }
}
