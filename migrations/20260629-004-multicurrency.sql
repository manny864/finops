-- Feature D: Multi-currency support
-- FX rates table (base = USD, rate = 1 USD -> N target currency)
-- UserCurrencyPreference per (tenant_id, user_oid)

CREATE TABLE IF NOT EXISTS FxRates (
    base_currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    target_currency VARCHAR(8) NOT NULL,
    rate DECIMAL(18, 8) NOT NULL,
    rate_date DATE NOT NULL,
    source VARCHAR(64) NOT NULL DEFAULT 'manual',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (base_currency, target_currency, rate_date),
    INDEX idx_target_date (target_currency, rate_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS UserCurrencyPreference (
    tenant_id VARCHAR(128) NOT NULL,
    user_oid VARCHAR(128) NOT NULL,
    display_currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, user_oid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
