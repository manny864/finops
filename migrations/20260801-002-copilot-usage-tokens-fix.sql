-- 20260801-002-copilot-usage-tokens-fix.sql
-- Fixes missing model_name columns if previous migration was applied but incomplete.
ALTER TABLE CopilotUsage
    ADD COLUMN model_name     VARCHAR(100) NULL AFTER user_email,
    ADD COLUMN provider       VARCHAR(50)  NULL AFTER model_name,
    ADD COLUMN input_tokens   INT          NOT NULL DEFAULT 0 AFTER provider,
    ADD COLUMN output_tokens  INT          NOT NULL DEFAULT 0 AFTER input_tokens,
    ADD COLUMN estimated_cost_usd DECIMAL(12,8) NOT NULL DEFAULT 0 AFTER output_tokens,
    ADD COLUMN platform_ai_usage_id BIGINT NULL AFTER estimated_cost_usd,
    ADD INDEX idx_copilot_usage_model (tenant_id, model_name, created_at);
