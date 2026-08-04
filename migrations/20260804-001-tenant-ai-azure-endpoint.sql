-- Azure IA BYOK per-tenant: endpoint URL + deployment (modelo), alineado con
-- la configuración global (ai_endpoint / ai_deployment en GlobalSettings y
-- enterprise_ai_*). Sin estos campos el tenant solo podía guardar API key y
-- dependía del endpoint/deployment de plataforma o de env vars.
--
-- Idempotencia: el runner tolera ER_DUP_FIELDNAME si las columnas ya existen.
ALTER TABLE Tenants
    ADD COLUMN ai_endpoint VARCHAR(512) NULL DEFAULT NULL,
    ADD COLUMN ai_deployment VARCHAR(128) NULL DEFAULT NULL;
