-- 2026-06-30: Make tenants.client_secret nullable.
--
-- Background: secrets ahora viven primariamente en Azure Key Vault
-- (lib/secrets/tenantCredentials). La columna en DB queda como backup
-- redundante durante la fase de migración para fallback en caso de
-- corte de red Hostinger ↔ Azure.
--
-- Después de ~30 días de operación estable con KV como source-of-truth,
-- correr 2026XXXX-tenants-secret-cleanup.sql para NULLificar la columna
-- (mantener la columna por compatibilidad).
--
-- Esta migración es idempotente: si la columna ya es NULLable, MySQL
-- no se queja del MODIFY redundante.

ALTER TABLE Tenants
  MODIFY COLUMN client_id      VARCHAR(255) NULL,
  MODIFY COLUMN client_secret  VARCHAR(255) NULL;
