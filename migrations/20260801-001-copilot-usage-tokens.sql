-- 20260801-001-copilot-usage-tokens.sql
-- Agrega columnas de auditoría de tokens y costo estimado a CopilotUsage.
-- Permite saber cuánto consume cada tenant (y cada usuario) en tokens reales
-- de IA, y vincular las queries del Copilot con la tabla PlatformAiUsage.
--
-- La cuota mensual pre-existente sigue funcionando igual (COUNT(*) sobre la
-- misma tabla). Este ALTER solo agrega info; no rompe nada existente.
--
-- Idempotente via IDEMPOTENT_ERRORS en migrations.ts.

ALTER TABLE CopilotUsage
    ADD COLUMN model_name     VARCHAR(100) NULL AFTER user_email,
    ADD COLUMN provider       VARCHAR(50)  NULL AFTER model_name,
    ADD COLUMN input_tokens   INT          NOT NULL DEFAULT 0 AFTER provider,
    ADD COLUMN output_tokens  INT          NOT NULL DEFAULT 0 AFTER input_tokens,
    ADD COLUMN estimated_cost_usd DECIMAL(12,8) NOT NULL DEFAULT 0 AFTER output_tokens,
    ADD COLUMN platform_ai_usage_id BIGINT NULL AFTER estimated_cost_usd,
    ADD INDEX idx_copilot_usage_model (tenant_id, model_name, created_at);
