-- TaggingPolicies: una sola forma, la canónica de 20260813-001 (snake_case:
-- tenant_id, policy_name, is_required, created_at, updated_at, clave única
-- uk_tenant_policy).
--
-- Según la historia de cada base conviven tres variantes:
--   * la de 20260728-003 (copiada del VPS): tag_key y required, sin updated_at
--     ni clave única. Es la que tienen las bases creadas con las migraciones.
--   * la canónica de 20260813-001: policy_name e is_required.
--   * camelCase (tenantId, policyName, isRequired, createdAt, updatedAt), la que
--     consultaba governance/policies/route.ts.
-- Cada paso mira INFORMATION_SCHEMA y renombra sólo si existe la columna vieja
-- y no la nueva: correrla dos veces, o sobre la canónica, no cambia nada.
-- RENAME COLUMN conserva tipo, índices y FKs.

SET @tbl := 'TaggingPolicies';

-- 1. tenantId -> tenant_id
SET @old := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'tenantId');
SET @new := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'tenant_id');
SET @ddl := IF(@old = 1 AND @new = 0, 'ALTER TABLE TaggingPolicies RENAME COLUMN tenantId TO tenant_id', 'SELECT 1');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

-- 2. policyName o tag_key -> policy_name
SET @new := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'policy_name');
SET @old := (SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME IN ('policyName', 'tag_key') LIMIT 1);
SET @ddl := IF(@new = 0 AND @old IS NOT NULL, CONCAT('ALTER TABLE TaggingPolicies RENAME COLUMN `', @old, '` TO policy_name'), 'SELECT 1');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

-- 3. isRequired o required -> is_required
SET @new := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'is_required');
SET @old := (SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME IN ('isRequired', 'required') LIMIT 1);
SET @ddl := IF(@new = 0 AND @old IS NOT NULL, CONCAT('ALTER TABLE TaggingPolicies RENAME COLUMN `', @old, '` TO is_required'), 'SELECT 1');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

-- 4. createdAt -> created_at
SET @old := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'createdAt');
SET @new := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'created_at');
SET @ddl := IF(@old = 1 AND @new = 0, 'ALTER TABLE TaggingPolicies RENAME COLUMN createdAt TO created_at', 'SELECT 1');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

-- 5. updatedAt -> updated_at, o se crea si no hay ninguna (variante del VPS).
SET @old := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'updatedAt');
SET @new := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'updated_at');
SET @ddl := IF(@new = 1, 'SELECT 1', IF(@old = 1,
  'ALTER TABLE TaggingPolicies RENAME COLUMN updatedAt TO updated_at',
  'ALTER TABLE TaggingPolicies ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

-- 6. Clave única (tenant, política). La variante del VPS no la tenía, así que
--    el ON DUPLICATE KEY de /api/tags insertaba duplicados: se conserva la fila
--    más vieja de cada par antes de crearla. Con la clave ya creada no hay
--    duplicados y el DELETE no borra nada.
DELETE p1 FROM TaggingPolicies p1
  JOIN TaggingPolicies p2 ON p1.tenant_id = p2.tenant_id AND p1.policy_name = p2.policy_name AND p1.id > p2.id;

SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND INDEX_NAME = 'uk_tenant_policy');
SET @ddl := IF(@c = 0, 'ALTER TABLE TaggingPolicies ADD UNIQUE KEY uk_tenant_policy (tenant_id, policy_name)', 'SELECT 1');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

-- 7. FK a Tenants con borrado en cascada. La variante del VPS ya la trae; la
--    canónica de 20260813-001 no. Si falta: misma collation que
--    Tenants.tenant_id (si no, MySQL rechaza la FK), fuera las filas huérfanas
--    y recién ahí la FK.
SET @fk := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'tenant_id' AND REFERENCED_TABLE_NAME = 'Tenants');
SET @ddl := IF(@fk = 0, 'ALTER TABLE TaggingPolicies MODIFY COLUMN tenant_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL', 'SELECT 1');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @ddl := IF(@fk = 0, 'DELETE FROM TaggingPolicies WHERE tenant_id NOT IN (SELECT tenant_id FROM Tenants)', 'SELECT 1');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @ddl := IF(@fk = 0, 'ALTER TABLE TaggingPolicies ADD CONSTRAINT fk_tagging_policies_tenant FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE', 'SELECT 1');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;
