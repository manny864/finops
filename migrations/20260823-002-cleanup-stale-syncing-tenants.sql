-- 20260823-002-cleanup-stale-syncing-tenants.sql
-- Resetea estados 'syncing' colgados en Tenants (ej. reinicios de container / timeouts)
-- y normaliza deployments inexistentes en GlobalSettings si apuntan a claude-haiku-4-5.

UPDATE Tenants 
SET sync_status = 'idle' 
WHERE sync_status = 'syncing' 
  AND (last_sync_at IS NULL OR last_sync_at < DATE_SUB(NOW(), INTERVAL 2 HOUR));

UPDATE GlobalSettings
SET setting_value = 'gpt-4o'
WHERE setting_key = 'ai_deployment'
  AND setting_value = 'claude-haiku-4-5';
