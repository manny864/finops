-- Alias de valores de etiquetas (propuesta de IA, 6.5): "production",
-- "producción" o "PRD" -> "prod". Los usa normalizeTagValue
-- (src/lib/tagValueNormalizer.ts) para sugerir el valor canónico de un valor
-- no permitido, antes de la distancia de edición y de la IA.
--
-- `alias` guarda la forma normalizada (minúsculas, sin acentos ni separadores:
-- "Pre-Prod" -> "preprod"), que es lo que compara el normalizador.
-- `tenant_id` NULL = alias global. Los del tenant salen de correcciones
-- aprobadas en Tag Governance y tienen prioridad sobre los globales.
CREATE TABLE IF NOT EXISTS TagValueAliases (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id       VARCHAR(255) NULL,
  tag_name        VARCHAR(128) NOT NULL,
  alias           VARCHAR(256) NOT NULL,
  canonical_value VARCHAR(256) NOT NULL,
  created_by      VARCHAR(255) NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tag_alias (tenant_id, tag_name, alias),
  CONSTRAINT fk_tag_value_aliases_tenant
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Alias globales, hacia los valores de DEFAULT_MANDATORY_TAG_POLICIES.
-- MySQL no considera iguales dos NULL en un índice único, así que la unicidad
-- de los globales la da el NOT EXISTS. El CONVERT + COLLATE evita el "Illegal
-- mix of collations" cuando la conexión no usa utf8mb4_unicode_ci (o ni
-- siquiera utf8mb4, como el cliente mysql sin locale).
INSERT INTO TagValueAliases (tenant_id, tag_name, alias, canonical_value)
SELECT NULL, s.tag_name, s.alias, s.canonical_value
  FROM (
    SELECT 'Environment' AS tag_name, 'production' AS alias, 'prod' AS canonical_value
    UNION ALL SELECT 'Environment', 'produccion', 'prod'
    UNION ALL SELECT 'Environment', 'producao', 'prod'
    UNION ALL SELECT 'Environment', 'productivo', 'prod'
    UNION ALL SELECT 'Environment', 'prd', 'prod'
    UNION ALL SELECT 'Environment', 'live', 'prod'
    UNION ALL SELECT 'Environment', 'development', 'dev'
    UNION ALL SELECT 'Environment', 'develop', 'dev'
    UNION ALL SELECT 'Environment', 'desarrollo', 'dev'
    UNION ALL SELECT 'Environment', 'desa', 'dev'
    UNION ALL SELECT 'Environment', 'desenvolvimento', 'dev'
    UNION ALL SELECT 'Environment', 'test', 'qa'
    UNION ALL SELECT 'Environment', 'testing', 'qa'
    UNION ALL SELECT 'Environment', 'tst', 'qa'
    UNION ALL SELECT 'Environment', 'teste', 'qa'
    UNION ALL SELECT 'Environment', 'prueba', 'qa'
    UNION ALL SELECT 'Environment', 'pruebas', 'qa'
    UNION ALL SELECT 'Environment', 'quality', 'qa'
    UNION ALL SELECT 'Environment', 'qualityassurance', 'qa'
    UNION ALL SELECT 'Environment', 'staging', 'stg'
    UNION ALL SELECT 'Environment', 'stage', 'stg'
    UNION ALL SELECT 'Environment', 'preprod', 'stg'
    UNION ALL SELECT 'Environment', 'preproduction', 'stg'
    UNION ALL SELECT 'Environment', 'preproduccion', 'stg'
    UNION ALL SELECT 'Environment', 'uat', 'stg'
    UNION ALL SELECT 'Environment', 'homologacion', 'stg'
    UNION ALL SELECT 'Environment', 'homologacao', 'stg'
    UNION ALL SELECT 'Environment', 'hml', 'stg'
    UNION ALL SELECT 'Environment', 'sbx', 'sandbox'
    UNION ALL SELECT 'Environment', 'lab', 'sandbox'
    UNION ALL SELECT 'Environment', 'playground', 'sandbox'
    UNION ALL SELECT 'Role', 'db', 'database'
    UNION ALL SELECT 'Role', 'bd', 'database'
    UNION ALL SELECT 'Role', 'sql', 'database'
    UNION ALL SELECT 'Role', 'mysql', 'database'
    UNION ALL SELECT 'Role', 'postgres', 'database'
    UNION ALL SELECT 'Role', 'postgresql', 'database'
    UNION ALL SELECT 'Role', 'basededatos', 'database'
    UNION ALL SELECT 'Role', 'bancodedados', 'database'
    UNION ALL SELECT 'Role', 'backend', 'api'
    UNION ALL SELECT 'Role', 'apis', 'api'
    UNION ALL SELECT 'Role', 'web', 'frontend'
    UNION ALL SELECT 'Role', 'webapp', 'frontend'
    UNION ALL SELECT 'Role', 'front', 'frontend'
    UNION ALL SELECT 'Role', 'ui', 'frontend'
    UNION ALL SELECT 'Role', 'backups', 'backup'
    UNION ALL SELECT 'Role', 'bkp', 'backup'
    UNION ALL SELECT 'Role', 'respaldo', 'backup'
    UNION ALL SELECT 'Role', 'aks', 'orchestrator'
    UNION ALL SELECT 'Role', 'k8s', 'orchestrator'
    UNION ALL SELECT 'Role', 'kubernetes', 'orchestrator'
    UNION ALL SELECT 'Role', 'orquestador', 'orchestrator'
    UNION ALL SELECT 'Role', 'net', 'network'
    UNION ALL SELECT 'Role', 'networking', 'network'
    UNION ALL SELECT 'Role', 'red', 'network'
    UNION ALL SELECT 'Role', 'rede', 'network'
    UNION ALL SELECT 'Role', 'blob', 'storage'
    UNION ALL SELECT 'Role', 'disk', 'storage'
    UNION ALL SELECT 'Role', 'almacenamiento', 'storage'
    UNION ALL SELECT 'Role', 'armazenamento', 'storage'
    UNION ALL SELECT 'Role', 'job', 'worker'
    UNION ALL SELECT 'Role', 'jobs', 'worker'
    UNION ALL SELECT 'Role', 'batch', 'worker'
    UNION ALL SELECT 'Role', 'function', 'worker'
    UNION ALL SELECT 'Role', 'functions', 'worker'
  ) s
 WHERE NOT EXISTS (
   SELECT 1 FROM TagValueAliases a
    WHERE a.tenant_id IS NULL
      AND a.tag_name = CONVERT(s.tag_name USING utf8mb4) COLLATE utf8mb4_unicode_ci
      AND a.alias = CONVERT(s.alias USING utf8mb4) COLLATE utf8mb4_unicode_ci
 );
