-- Configuración de IA: pista enmascarada de la API key y resultado de la última
-- prueba de conexión.
--
-- Se extiende `Tenants` porque TODA la configuración de IA ya vive ahí desde
-- 20260628-001 / 20260719-001 / 20260804-001 (ai_provider, ai_api_key cifrada,
-- ai_endpoint, ai_deployment, ai_enabled, ai_anomaly_sensitivity,
-- ai_share_resource_names, ai_share_tags). Crear `TenantAiSettings` habría
-- partido la configuración en dos lugares y obligado a migrar ocho columnas en
-- uso, sin ganar nada: la relación es 1:1.
--
-- `ai_api_key_hint` NO es un secreto: son los últimos 4 caracteres de la clave
-- (formato `sk-...4a1b`) para que el admin reconozca cuál cargó sin poder
-- reconstruirla. La clave completa sigue cifrada en `ai_api_key` y nunca se
-- devuelve al cliente.

ALTER TABLE Tenants
    ADD COLUMN ai_api_key_hint VARCHAR(32) NULL DEFAULT NULL;

ALTER TABLE Tenants
    ADD COLUMN ai_last_connection_test_at DATETIME NULL DEFAULT NULL;

ALTER TABLE Tenants
    ADD COLUMN ai_last_connection_status ENUM('SUCCESS','FAILED') NULL DEFAULT NULL;
