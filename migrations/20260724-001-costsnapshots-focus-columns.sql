-- Migration: 20260724-001-costsnapshots-focus-columns.sql
-- Agrega a CostSnapshots las columnas FOCUS que la app da por existentes.
--
-- Estas columnas se habían agregado a mano en el VPS durante el trabajo del
-- exportador FOCUS y nunca entraron a una migración. El rastro quedó en el
-- comentario de 20260629-007-aws-accounts.sql:
--   "CostSnapshots already has ProviderName, BillingAccountId,
--    ChargePeriodStart/End, BilledCost, EffectiveCost ... (added during FOCUS
--    exporter work)"
-- ...que era cierto sólo en esa base. En una base creada desde las migraciones
-- no existen, y 20260725-002 muere con ER_KEY_COLUMN_DOES_NOT_EXITS al indexar
-- ProviderName. Verificado 2026-07-28 montando el esquema desde cero.
--
-- No es un detalle menor: 26 archivos consultan EffectiveCost y 24
-- ChargePeriodStart contra CostSnapshots. Sin esto, toda la capa de reportes
-- FOCUS falla en runtime aunque el esquema "termine" de migrar.
--
-- El nombre la ordena antes de 20260725-001/002, que las necesitan.
--
-- Tipos tomados de FocusLineItems (20260725-001), que modela las mismas
-- columnas de la especificación FOCUS — así las dos tablas no divergen.
--
-- Todas NULL / con default: son filas que ya existen sin estos datos, y el
-- sync las completa cuando corre.

ALTER TABLE CostSnapshots ADD COLUMN ProviderName VARCHAR(50) NULL;

-- ARN en AWS, resourceId en Azure.
ALTER TABLE CostSnapshots ADD COLUMN ResourceId VARCHAR(512) NULL;

-- DATETIME y no DATE: la spec FOCUS admite grano horario, igual que en
-- FocusLineItems. La columna `date` preexistente se mantiene: es la que usa el
-- resto del producto para agrupar por día.
ALTER TABLE CostSnapshots ADD COLUMN ChargePeriodStart DATETIME NULL;
ALTER TABLE CostSnapshots ADD COLUMN ChargePeriodEnd DATETIME NULL;

-- DECIMAL(18,8) y no (12,4) como cost_usd: son los importes FOCUS, con la misma
-- precisión que FocusLineItems para que no se pierdan decimales al cruzarlas.
ALTER TABLE CostSnapshots ADD COLUMN BilledCost DECIMAL(18,8) NULL;
ALTER TABLE CostSnapshots ADD COLUMN EffectiveCost DECIMAL(18,8) NULL;

-- Tags: mismo tipo que en FocusLineItems. Hace falta también porque
-- 20260728-001 la usa como ancla posicional (`ADD COLUMN allocation_tag_hash
-- ... AFTER Tags`) y sin ella corta con ER_BAD_FIELD_ERROR. Con la columna
-- presente, el resto de esa migración queda cubierto por los códigos que el
-- runner ya trata como idempotentes (ER_DUP_FIELDNAME, ER_DUP_KEYNAME,
-- ER_CANT_DROP_FIELD_OR_KEY), porque el bootstrap actual ya trae
-- allocation_tag_hash y su UNIQUE KEY.
ALTER TABLE CostSnapshots ADD COLUMN Tags JSON NULL;

-- El filtro más frecuente de los reportes es por tenant + ventana temporal.
CREATE INDEX idx_costsnapshots_charge_period ON CostSnapshots (tenant_id, ChargePeriodStart);
