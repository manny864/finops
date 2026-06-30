-- AWS multi-cloud integration: AwsAccounts table
-- Stores assume-role configuration + optional CUR S3 export settings.

CREATE TABLE IF NOT EXISTS AwsAccounts (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    account_id VARCHAR(20) NOT NULL,                -- 12-digit AWS account ID
    role_arn VARCHAR(2048) NOT NULL,                -- arn:aws:iam::123456789012:role/FinOpsReader
    external_id_encrypted TEXT NOT NULL,            -- AES-256-GCM JSON {ciphertext,iv,authTag}
    alias VARCHAR(255) NOT NULL,                    -- human label e.g. "prod-us-east"
    cur_bucket VARCHAR(255) NULL,                   -- optional CUR S3 bucket (e.g. acme-cur-exports)
    cur_prefix VARCHAR(512) NULL,                   -- prefix inside the bucket
    cur_report_name VARCHAR(255) NULL,              -- CUR report name (matches manifest folder)
    last_sync_at DATETIME NULL,
    sync_status ENUM('OK','ERROR','SYNCING','NEVER') DEFAULT 'NEVER',
    last_error_message TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_tenant_account (tenant_id, account_id),
    INDEX idx_tenant (tenant_id),
    INDEX idx_sync_status (sync_status)
);

-- CostSnapshots already has ProviderName, BillingAccountId, ChargePeriodStart/End, BilledCost,
-- EffectiveCost, ServiceName etc. (added during FOCUS exporter work). We just write into them
-- with ProviderName='AWS' and BillingAccountId=account_id.
