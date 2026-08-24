-- Agregar columnas extendidas a la tabla Notifications para compatibilidad con TenantNotificationsService
-- Idempotente: seguro para producción en Azure Container Apps

ALTER TABLE Notifications ADD COLUMN IF NOT EXISTS type VARCHAR(50) NOT NULL DEFAULT 'SYSTEM_ALERT';
ALTER TABLE Notifications ADD COLUMN IF NOT EXISTS action_url VARCHAR(500) NULL;
ALTER TABLE Notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE Notifications ADD COLUMN IF NOT EXISTS read_at DATETIME NULL;
