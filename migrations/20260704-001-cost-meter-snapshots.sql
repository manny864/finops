-- 20260704-001 — Tabla dedicada para filas de costo a nivel de meter.
--
-- Problema: el cron sync escribía dos vistas del mismo costo en CostSnapshots:
--   A) agrupado por ResourceGroup (chargeback) y
--   B) agrupado por MeterSubCategory con resource_group='*' (detección de tiers
--      de storage / SKUs de compute).
-- La UNIQUE KEY (tenant, sub, date, resource_group, service_name) hacía que
-- todas las filas B de un mismo servicio colisionaran entre sí: cada
-- ON DUPLICATE KEY UPDATE pisaba la subcategoría anterior y solo sobrevivía
-- la última (storage-efficiency nunca veía los tiers reales). Además, A+B en
-- la misma tabla duplicaba el costo en cualquier consumidor que sume.
--
-- Solución: las filas B viven en su propia tabla, con la subcategoría dentro
-- de la clave de idempotencia. CostSnapshots queda solo con las filas A.

CREATE TABLE IF NOT EXISTS CostMeterSnapshots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    subscription_id VARCHAR(100) NOT NULL DEFAULT 'default',
    date DATE NOT NULL,
    service_name VARCHAR(100) NOT NULL,
    MeterCategory VARCHAR(255) NOT NULL DEFAULT '',
    MeterSubCategory VARCHAR(255) NOT NULL DEFAULT '',
    MeterName VARCHAR(255) NOT NULL DEFAULT '',
    cost_usd DECIMAL(12, 4) NOT NULL,
    Quantity DECIMAL(18, 6) NULL,
    UnitOfMeasure VARCHAR(64) NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
    UNIQUE KEY uq_meter_row (tenant_id, subscription_id, date, service_name, MeterSubCategory),
    INDEX idx_tenant_date (tenant_id, date)
);

-- Limpieza: las filas B históricas en CostSnapshots están corruptas por el
-- colapso descrito arriba (una sola subcategoría por servicio, con costo
-- parcial) y además duplican el costo de las filas A. Se eliminan; los
-- próximos syncs pueblan CostMeterSnapshots con datos correctos.
DELETE FROM CostSnapshots
 WHERE resource_group = '*'
   AND COALESCE(MeterSubCategory, '') <> '';
