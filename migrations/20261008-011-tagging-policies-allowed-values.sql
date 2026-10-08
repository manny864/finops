-- Valores permitidos por política de etiquetado (propuesta de IA, 6.5).
--
-- `allowed_values` es un arreglo JSON de strings; NULL = valor libre (sólo se
-- exige presencia, como CostCenter y Department). El escáner de Tag Governance
-- marca "valor no permitido" cuando el valor no es exactamente uno de la lista.
--
-- Backfill: las filas Environment y Role que sembró 20260813-001 toman los
-- valores de DEFAULT_MANDATORY_TAG_POLICIES (azureTagGovernance.service.ts). Si
-- quedaran en NULL, tener políticas propias apagaría la validación que el
-- tenant sin políticas sí tiene. Corre sólo cuando la columna se crea acá: en
-- una segunda corrida no pisa un NULL puesto a propósito.

SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'TaggingPolicies' AND COLUMN_NAME = 'allowed_values');
SET @ddl := IF(@c = 0, 'ALTER TABLE TaggingPolicies ADD COLUMN allowed_values JSON NULL AFTER is_required', 'SELECT 1');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

UPDATE TaggingPolicies
   SET allowed_values = JSON_ARRAY('prod', 'stg', 'dev', 'qa', 'sandbox')
 WHERE @c = 0 AND policy_name = 'Environment' AND allowed_values IS NULL;

UPDATE TaggingPolicies
   SET allowed_values = JSON_ARRAY('database', 'api', 'frontend', 'backup', 'orchestrator', 'network', 'storage', 'worker')
 WHERE @c = 0 AND policy_name = 'Role' AND allowed_values IS NULL;
