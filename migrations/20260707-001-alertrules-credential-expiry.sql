-- 20260707-001-alertrules-credential-expiry.sql
-- Nuevo tipo de regla de alerta: 'credential_expiry' — notifica cuando alguna
-- credencial de App Registration (password/certificado) vence dentro de
-- threshold_value días (threshold_unit = 'days'). Evaluada por el cron
-- /api/cron/credential-expiry-alerts usando los canales existentes
-- (email / Slack / Teams webhook).
-- Idempotente: MODIFY COLUMN con el set completo es re-ejecutable.
ALTER TABLE AlertRules
    MODIFY COLUMN rule_type ENUM('budget','anomaly','forecast','threshold','credential_expiry') NOT NULL;
