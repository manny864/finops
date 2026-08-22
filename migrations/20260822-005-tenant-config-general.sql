-- Configuración Global (pestaña General): preferencia de tema e integración ITSM.
--
-- Se extiende `Tenants` en vez de crear `TenantGlobalSettings` / `TenantIntegrations`:
--   * `webhook_url` (alertas proactivas) y `logo_stored_name` (branding) YA viven acá.
--     Moverlos a una tabla nueva obligaría a reescribir /api/admin/config/webhook y
--     /api/admin/tenants/logo y a migrar datos, y mientras tanto habría dos fuentes de
--     verdad para el mismo hecho — el padrón paralelo que el LLD §32.4 rechaza.
--   * La config de IA (`ai_provider`, `ai_endpoint`, `ai_api_key` cifrada) ya sienta el
--     precedente exacto para "proveedor + endpoint + credencial cifrada" como columnas.
--   * La relación es 1:1 con el tenant, así que una tabla aparte sólo agrega un JOIN.
--
-- El token de Power BI NO se agrega acá: se reutiliza `MCPApiKeys` (sha256, revocable,
-- ya consumido por /api/exports/powerbi-feed).

ALTER TABLE Tenants
    ADD COLUMN theme_preference ENUM('LIGHT','DARK','SYSTEM') NOT NULL DEFAULT 'SYSTEM';

-- Sistema de ticketing destino. 'NONE' = sin integración (default explícito, no NULL:
-- distinguir "sin configurar" de "configurado a nada" no aporta nada acá).
ALTER TABLE Tenants
    ADD COLUMN itsm_system ENUM('JIRA','AZURE_DEVOPS','SERVICENOW','NONE') NOT NULL DEFAULT 'NONE';

ALTER TABLE Tenants
    ADD COLUMN itsm_base_url VARCHAR(512) NULL;

-- Jira Cloud y ServiceNow autentican con usuario+token (basic auth); Azure DevOps con
-- PAT y usuario vacío. Se guarda el identificador junto al secreto para no tener que
-- pedirlo de nuevo en cada prueba de conexión.
ALTER TABLE Tenants
    ADD COLUMN itsm_user_email VARCHAR(255) NULL;

-- Cifrada con secretCrypto (`enc:v1:iv:authTag:ciphertext`, AES-256-GCM), mismo
-- mecanismo que `ai_api_key`. Nunca se devuelve al cliente: la API sólo expone
-- el booleano `isItsmConfigured`.
ALTER TABLE Tenants
    ADD COLUMN itsm_api_key_encrypted VARCHAR(1024) NULL;

ALTER TABLE Tenants
    ADD COLUMN itsm_project_key VARCHAR(64) NULL;
