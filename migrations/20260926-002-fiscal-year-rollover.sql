-- Migration: 20260926-002-fiscal-year-rollover.sql
-- MEJ-36 — año fiscal no calendario y arrastre de presupuesto.
--
-- EL AÑO FISCAL ARREGLA ALGO QUE ESTABA MAL EN SILENCIO. Estaba cableado a
-- enero en cuatro lugares del codigo, asi que para un cliente cuyo ejercicio
-- arranca en abril TODOS los acumulados anuales de la plataforma estaban
-- corridos tres meses, y no lo decia en ningun lado. El default de 1 conserva
-- exactamente el comportamiento de hoy para todos los tenants existentes.
--
-- EL ARRASTRE es opcional y arranca apagado por la misma razon: con
-- `rollover_enabled = 0` el panel calcula lo mismo que calculaba antes.

ALTER TABLE Tenants
    ADD COLUMN fiscal_year_start_month TINYINT NOT NULL DEFAULT 1
    COMMENT 'Mes 1-12 en que arranca el ejercicio. 1 = calendario (MEJ-36)';

-- Lo no ejecutado del mes se suma al siguiente. Por presupuesto y no por
-- tenant: conviven centros de costo que arrastran con otros que no.
ALTER TABLE CostCenterBudgets
    ADD COLUMN rollover_enabled TINYINT(1) NOT NULL DEFAULT 0
    COMMENT 'Arrastra lo no ejecutado al mes siguiente (MEJ-36)';

-- NULL = sin tope. Se guarda con la misma precision que `monthly_budget_usd`
-- para que comparar los dos no pierda centavos.
ALTER TABLE CostCenterBudgets
    ADD COLUMN rollover_cap_usd DECIMAL(12,4) NULL
    COMMENT 'Tope del arrastre acumulado. NULL = sin tope (MEJ-36)';
