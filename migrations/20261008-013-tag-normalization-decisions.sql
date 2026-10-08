-- Decisiones sobre valores de etiquetas no conformes (propuesta de IA, 6.5).
-- Una fila por corrección aplicada o sugerencia descartada en Tag Governance.
-- Alimenta los KPIs de normalización: qué porcentaje se resolvió por regla, por
-- IA o a mano, y la tasa de aceptación de las sugerencias.
--
--   suggestion_source: 'rule' (normalizador determinista) | 'ai' | NULL (sin sugerencia)
--   applied_value:     valor que se aplicó; NULL = sugerencia descartada
--   accepted:          1 si se aplicó lo sugerido, 0 si se aplicó otro valor o se
--                      descartó, NULL si no había sugerencia
CREATE TABLE IF NOT EXISTS TagNormalizationDecisions (
  id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id            VARCHAR(255) NOT NULL,
  tag_name             VARCHAR(128) NOT NULL,
  original_value       VARCHAR(256) NOT NULL,
  suggested_value      VARCHAR(256) NULL,
  suggestion_source    VARCHAR(8) NULL,
  suggested_method     VARCHAR(16) NULL,
  suggested_confidence DECIMAL(4,3) NULL,
  applied_value        VARCHAR(256) NULL,
  accepted             TINYINT(1) NULL,
  resource_count       INT NOT NULL DEFAULT 0,
  decided_by           VARCHAR(255) NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tag_norm_tenant_created (tenant_id, created_at),
  CONSTRAINT fk_tag_norm_decisions_tenant
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
