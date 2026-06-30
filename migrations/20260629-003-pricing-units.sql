-- 20260629-003 — Pricing Units lookup (toolkit-derived).
-- Mapeo de UoM raw del billing Azure a bloques normalizados.
-- Fuente: microsoft/finops-toolkit src/open-data/PricingUnits.csv

CREATE TABLE IF NOT EXISTS PricingUnits (
    uom_raw VARCHAR(100) NOT NULL PRIMARY KEY,
    block_size DECIMAL(18,6) NOT NULL DEFAULT 1.0,
    base_unit VARCHAR(50) NOT NULL,
    display_unit VARCHAR(100),
    category VARCHAR(50),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_category (category)
);
