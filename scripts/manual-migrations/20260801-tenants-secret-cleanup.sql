-- ⚠️  MIGRACIÓN MANUAL — NO colocar en /migrations (el runner la aplicaría
-- automáticamente en el próximo deploy). Ejecutar a mano contra la DB.
--
-- Cleanup post-migración: ejecutar SOLO después de:
--   1) scripts/migrate-tenants-to-keyvault.ts → éxito.
--   2) 30 días observando logs sin "[tenantCredentials] KV read failed"
--      y sin fallbacks a DB.
--   3) Confirmación de que cron/sync, governance/expiring-credentials,
--      check-sp-roles y entra-sync están funcionando vía source=keyvault.
--
-- Esto nullifica los secrets en plano pero mantiene la columna por
-- compatibilidad de schema con módulos legacy.

UPDATE Tenants
SET    client_secret = NULL
WHERE  client_secret IS NOT NULL;

-- (Opcional, paranoia extra) también nullificar client_id:
-- UPDATE Tenants SET client_id = NULL WHERE client_id IS NOT NULL;

-- Verificación:
SELECT COUNT(*) AS tenants_with_secret_in_db
FROM   Tenants
WHERE  client_secret IS NOT NULL;
-- Debe devolver 0.
