-- Migration: 20260728-002-tenants-sync-status.sql
-- Agrega Tenants.sync_status, que la app da por existente y nunca se creó.
--
-- Mismo patrón que las columnas FOCUS de CostSnapshots (ver 20260724-001):
-- estaba agregada a mano en el VPS y nunca entró a una migración. En una base
-- creada desde cero la consulta revienta con
--   Unknown column 'sync_status' in 'field list'
-- Verificado 2026-07-28 en el /api/status del stamp de Azure.
--
-- No es cosmético: lo consultan dos caminos,
--   src/app/api/status/route.ts            → deja "Azure Sync" en degraded
--   src/app/api/cron/status-snapshot/route.ts → falla cada 5 minutos
-- y el error quedaba tapado por el catch del health check, que devuelve
-- "degraded" sin distinguir "sincronización con problemas" de "la consulta ni
-- siquiera corre".
--
-- OJO, no confundir con las otras dos sync_status que ya existen:
--   tenant_health.sync_status  VARCHAR(50)  — histórico por chequeo
--   AwsAccounts.sync_status    ENUM         — estado de la cuenta AWS
-- Ésta es el estado denormalizado del último sync del tenant.
--
-- VARCHAR(50) y no ENUM: sigue a tenant_health, que es la contraparte directa.
-- Un ENUM obligaría a un ALTER cada vez que se agregue un estado nuevo.
-- Los valores que escribe la app hoy son 'OK' y 'ERROR'.
--
-- Default NULL: un tenant recién creado todavía no sincronizó. El health check
-- sólo cuenta como sanos los que están en 'OK', así que NULL no lo ensucia.

ALTER TABLE Tenants ADD COLUMN sync_status VARCHAR(50) NULL;

-- El health check filtra por este valor sobre todos los tenants.
CREATE INDEX idx_tenants_sync_status ON Tenants (sync_status);
