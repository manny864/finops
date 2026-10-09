-- MEJ-20 — Shift-Left FinOps: el Budget Gate mira el presupuesto, no sólo un monto.
--
-- Hasta acá el gate de un repositorio era un monto fijo en USD. Eso no dice si el
-- PR cabe en lo que le queda a quien lo paga. Se suman dos cosas a IacBudgetGates:
--
--   cost_center_name           A qué centro de costos pertenece el repositorio (el
--                              valor del tag `CostCenter`, igual que en la pantalla
--                              de Centros de Costo). Con eso el comentario del PR
--                              puede decir cuánto del presupuesto del centro consume.
--   threshold_pct_of_remaining El PR se marca EXCEEDED si agrega más que este
--                              porcentaje de lo que le queda al presupuesto del mes.
--
-- `threshold_usd` pasa a admitir NULL: un repositorio puede tener sólo el gate por
-- porcentaje, o sólo el contexto de presupuesto (centro de costos sin umbral).
--
-- Y IacCostEstimations gana `meta_json`: lo que se calculó al estimar y no tiene
-- columna propia (descuento aplicado, precio de lista, presupuesto, herramienta).
-- JSON y no columnas porque son datos de lectura que cambian con el producto; lo
-- que se filtra o se suma sigue teniendo columna.
--
-- Idempotente: cada ALTER corre sólo si la columna no existe (MySQL no soporta
-- ADD COLUMN IF NOT EXISTS).

SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'IacBudgetGates' AND COLUMN_NAME = 'cost_center_name');
SET @ddl := IF(@c = 0,
    'ALTER TABLE IacBudgetGates
        ADD COLUMN cost_center_name VARCHAR(255) NULL AFTER repository,
        ADD COLUMN threshold_pct_of_remaining DECIMAL(6, 2) NULL AFTER threshold_usd,
        MODIFY COLUMN threshold_usd DECIMAL(12, 4) NULL',
    'SELECT 1');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'IacCostEstimations' AND COLUMN_NAME = 'meta_json');
SET @ddl := IF(@c = 0, 'ALTER TABLE IacCostEstimations ADD COLUMN meta_json JSON NULL AFTER detail_json', 'SELECT 1');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;
