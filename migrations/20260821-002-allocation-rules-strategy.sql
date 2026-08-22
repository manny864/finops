-- Prorrateo de costos compartidos: enriquece `AllocationRules`.
--
-- La tabla original (20260728-003) es plana: una fila por
-- (recurso, centro de costo, porcentaje), sin estrategia ni tipo de recurso.
-- El motor de prorrateo necesita saber CÓMO se reparte (porcentaje fijo,
-- telemetría dinámica de AKS/LAW, o proporcional al gasto directo) y sobre qué
-- clase de recurso compartido, para poder validar la suma y calcular montos.
--
-- Se extiende la tabla existente en vez de crear una paralela: las filas
-- actuales son reglas de porcentaje fijo perfectamente válidas y no hay motivo
-- para migrarlas a otro lado.
--
-- Idempotente: cada ALTER se condiciona con INFORMATION_SCHEMA, que es lo que
-- MySQL exige al no admitir ADD COLUMN IF NOT EXISTS.

-- Helper repetido por columna: MySQL no permite parametrizar DDL de otra forma.
SET @tbl := 'AllocationRules';

-- 1. Identificador del recurso compartido (resource ID de Azure). El
--    `resourceName` existente queda como etiqueta legible.
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'sharedResourceId');
SET @ddl := IF(@c = 0,
  'ALTER TABLE AllocationRules ADD COLUMN sharedResourceId VARCHAR(512) NULL AFTER resourceName',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. Tipo de recurso compartido: gobierna qué estrategias dinámicas aplican.
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'resourceType');
SET @ddl := IF(@c = 0,
  'ALTER TABLE AllocationRules ADD COLUMN resourceType VARCHAR(64) NOT NULL DEFAULT ''Other'' AFTER sharedResourceId',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- 3. Estrategia de reparto. Las filas preexistentes son porcentaje fijo, que es
--    justamente el DEFAULT, así que el backfill es implícito.
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'allocationStrategy');
SET @ddl := IF(@c = 0,
  'ALTER TABLE AllocationRules ADD COLUMN allocationStrategy VARCHAR(40) NOT NULL DEFAULT ''FIXED_PERCENTAGE'' AFTER resourceType',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- 4. Nombre legible de la regla, para agrupar las filas de un mismo recurso.
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = 'ruleName');
SET @ddl := IF(@c = 0,
  'ALTER TABLE AllocationRules ADD COLUMN ruleName VARCHAR(255) NULL AFTER tenantId',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- 5. Índice por tenant + recurso: el motor agrupa siempre por esa pareja.
SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND INDEX_NAME = 'idx_tenant_resource');
SET @ddl := IF(@c = 0,
  'ALTER TABLE AllocationRules ADD INDEX idx_tenant_resource (tenantId, resourceName)',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- 6. Las reglas viejas heredan su propio nombre de recurso como nombre de regla,
--    para que la UI no muestre filas sin título. Solo donde está vacío.
UPDATE AllocationRules SET ruleName = resourceName WHERE ruleName IS NULL OR ruleName = '';
