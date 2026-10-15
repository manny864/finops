-- AISEC-05 — AiCache aislada por tenant y con vencimiento físico.
--
-- tenant_id: toda lectura filtra por él (src/lib/aiCache.ts). Las filas viejas quedan en
-- NULL, ya no se leen y las borra el cron ai-cache-purge.
-- expires_at: el TTL antes sólo se comparaba al leer y las filas nunca se borraban.
--
-- Idempotente: cada ALTER corre sólo si la columna/índice no existe.

SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'AiCache' AND COLUMN_NAME = 'tenant_id');
SET @ddl := IF(@c = 0,
    'ALTER TABLE AiCache
        ADD COLUMN tenant_id VARCHAR(255) NULL AFTER hash_prompt,
        ADD COLUMN expires_at TIMESTAMP NULL DEFAULT NULL AFTER created_at',
    'SELECT 1');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'AiCache' AND INDEX_NAME = 'idx_aicache_tenant');
SET @ddl := IF(@c = 0, 'CREATE INDEX idx_aicache_tenant ON AiCache (tenant_id)', 'SELECT 1');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'AiCache' AND INDEX_NAME = 'idx_aicache_expires');
SET @ddl := IF(@c = 0, 'CREATE INDEX idx_aicache_expires ON AiCache (expires_at)', 'SELECT 1');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;
