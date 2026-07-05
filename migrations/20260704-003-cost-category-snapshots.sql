-- 20260704-003 — Filas de costo por ResourceType, para el desglose por
-- categoría FinOps (Compute/Storage/Networking/Databases/...).
--
-- El desglose por categoría necesita la clave de join nativa de FOCUS:
-- ResourceType (p.ej. 'microsoft.compute/virtualmachines'), que se une a
-- OpenDataServices.resource_type → service_category. El ServiceName de billing
-- que ya guardamos NO alcanza (deja ~25% del costo sin categorizar).
--
-- Tabla dedicada (mismo patrón que CostMeterSnapshots): evita tocar la grain ni
-- la unique key de CostSnapshots, que muchos consumidores (billing, forecast,
-- chargeback) leen asumiendo su granularidad actual.

CREATE TABLE IF NOT EXISTS CostCategorySnapshots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    subscription_id VARCHAR(100) NOT NULL DEFAULT 'default',
    date DATE NOT NULL,
    resource_type VARCHAR(200) NOT NULL DEFAULT '',
    cost_usd DECIMAL(12, 4) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
    UNIQUE KEY uq_category_row (tenant_id, subscription_id, date, resource_type),
    INDEX idx_tenant_date (tenant_id, date)
);
