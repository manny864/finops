CREATE TABLE IF NOT EXISTS AICostSnapshots (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    subscription_id VARCHAR(255) NULL,
    resource_name VARCHAR(255) NOT NULL,
    resource_group VARCHAR(255) NULL,
    model_name VARCHAR(255) NOT NULL,
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    billed_cost DECIMAL(14,6) NOT NULL DEFAULT 0,
    effective_cost DECIMAL(14,6) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_ai_daily (tenant_id, date, resource_name, model_name),
    INDEX idx_ai_tenant_date (tenant_id, date),
    INDEX idx_ai_model (model_name)
);
