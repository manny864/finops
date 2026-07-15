-- 20260715-001-create-copilot-usage.sql
-- Registro de consultas al FinOps Copilot (IA), una fila por request aceptado
-- (no por token). Usado para aplicar la cuota mensual por tier (ver
-- src/lib/copilotConfig.ts) del mismo modo que SupportTickets aplica su
-- cuota mensual (conteo por mes calendario vía created_at).
--
-- No se registran tenants demo/mock (isMockTenant en route.ts) — esos IDs no
-- existen en Tenants y romperían el FK; además el demo público no debe estar
-- sujeto a cuota.
--
-- Idempotente: IF NOT EXISTS. FK a Tenants en paridad con SupportTickets/Budgets.
CREATE TABLE IF NOT EXISTS CopilotUsage (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_copilot_usage_tenant_created (tenant_id, created_at),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
);
