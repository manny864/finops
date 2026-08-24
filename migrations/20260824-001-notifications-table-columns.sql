-- Agregar columnas extendidas a la tabla Notifications para compatibilidad con TenantNotificationsService
-- Sintaxis estándar MySQL (el migration runner ignora ER_DUP_FIELDNAME de forma idempotente)

ALTER TABLE Notifications ADD COLUMN type VARCHAR(50) NOT NULL DEFAULT 'SYSTEM_ALERT';
ALTER TABLE Notifications ADD COLUMN action_url VARCHAR(500) NULL;
ALTER TABLE Notifications ADD COLUMN is_read BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE Notifications ADD COLUMN read_at DATETIME NULL;
