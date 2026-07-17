-- Cada canal (Slack/Teams/Email) ya tiene su propio enabled/disabled
-- (NotificationChannels.enabled), pero no había forma de apagar TODAS las
-- notificaciones de un tenant de una sola vez sin desactivar canal por canal
-- (y perder esa config al reactivar). Este toggle maestro vive a nivel
-- Tenant y se evalúa en notifyTenant() antes de recorrer los canales.
ALTER TABLE Tenants
    ADD COLUMN notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;
