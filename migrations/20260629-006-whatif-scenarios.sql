-- 20260629-006-whatif-scenarios.sql
-- What-If simulator: persisted scenarios for save + compare lado-a-lado.

CREATE TABLE IF NOT EXISTS WhatIfScenarios (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    name VARCHAR(120) NOT NULL,
    notes TEXT NULL,
    -- input deltas as JSON so we can extend without schema changes
    inputs_json JSON NOT NULL,
    -- snapshotted result so historical scenarios stay comparable
    -- even if the underlying baseCost drifts later
    base_cost DECIMAL(14,4) NOT NULL,
    projected_cost DECIMAL(14,4) NOT NULL,
    compute_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
    storage_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
    network_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
    INDEX idx_tenant (tenant_id),
    INDEX idx_tenant_created (tenant_id, created_at DESC)
);
