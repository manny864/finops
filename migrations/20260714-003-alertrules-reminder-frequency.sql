-- Recurrencia configurable del recordatorio de una AlertRule. NULL = alertar
-- una sola vez (nunca más, aunque la condición se siga cumpliendo). Antes
-- estaba hardcodeado a 23h en el cron de credential-expiry (comentario
-- "una notificación por regla por día"); ahora es por-regla y editable desde
-- el formulario de creación de alerta (ver ExpiringCredentialsPanel.tsx).
ALTER TABLE AlertRules
    ADD COLUMN reminder_frequency_hours INT NULL DEFAULT 24 AFTER channel_target;
