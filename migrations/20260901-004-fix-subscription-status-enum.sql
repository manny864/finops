-- Bug: las cancelaciones fallaban en silencio.
--
-- `subscription_status` quedó como ENUM('TRIAL','ACTIVE','EXPIRED') en toda
-- base cuya tabla `Tenants` sea anterior al bootstrap del 2026-06-28. Ese
-- bootstrap SÍ declara el enum completo, pero es `CREATE TABLE IF NOT EXISTS`:
-- sobre una tabla preexistente corrió, se registró como aplicado en
-- SchemaMigrations, y no modificó nada. `src/modules/storage/schema.sql`
-- —el baseline de referencia, que no se ejecuta— arrastraba el mismo error.
--
-- CONSECUENCIA (verificada con STRICT_TRANS_TABLES, que es el sql_mode real):
--   UPDATE Tenants SET subscription_status='CANCELED' ...
--   ERROR 1265 (01000): Data truncated for column 'subscription_status'
-- El UPDATE aborta y el tenant QUEDA ACTIVE. O sea: un cliente que cancela en
-- Paddle o en el Marketplace conserva el acceso, y ninguna baja quedó
-- registrada nunca. Afecta a 5 rutas: los webhooks de Paddle y Marketplace,
-- /api/billing, /api/billing/subscription y saasBilling.service.
--
-- `EXPIRED` ya era válido, así que el cron de vencimiento sí funcionaba: por
-- eso el hueco pasó desapercibido.
--
-- No se agrega `CANCELED_PENDING` (lo escribe saasBilling.service.ts:217): no
-- está en ninguna definición del esquema y `listAllTenantsForSuperAdmin` mapea
-- todo valor desconocido a 'ACTIVE', así que un tenant en ese estado se vería
-- como activo. Ese camino además usa `WHERE id = ?` pasándole un tenant_id, y
-- vive dentro de un catch que se traga el error. Se documenta en MEJ-12 en vez
-- de consagrar un estado que el resto del sistema no entiende.
ALTER TABLE Tenants
    MODIFY COLUMN subscription_status
    ENUM('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED') DEFAULT 'ACTIVE';
