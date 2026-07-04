-- 20260704-002 — Región (ResourceLocation) en filas de costo a nivel de meter.
--
-- compute-cost-per-core mostraba la región como 'unknown' porque la query B del
-- sync agrupaba solo por (ServiceName, Meter) — sin dimensión de ubicación — y
-- el endpoint derivaba la "región" de resource_group (vacío en filas de meter, y
-- de todos modos un RG no es una región). Ahora la query B agrega la dimensión
-- ResourceLocation y la persistimos acá.
--
-- La región integra la UNIQUE KEY: un mismo meter puede facturar en varias
-- regiones el mismo día; sin la región en la clave, esas filas colisionarían y
-- ON DUPLICATE KEY UPDATE dejaría una sola (mismo bug que motivó esta tabla).

ALTER TABLE CostMeterSnapshots
    ADD COLUMN resource_location VARCHAR(64) NOT NULL DEFAULT '';

-- Reconstruir la unique key para incluir resource_location.
-- (idempotente: el runner ignora ER_CANT_DROP_FIELD_OR_KEY y ER_DUP_KEYNAME)
ALTER TABLE CostMeterSnapshots DROP INDEX uq_meter_row;
ALTER TABLE CostMeterSnapshots
    ADD UNIQUE KEY uq_meter_row (tenant_id, subscription_id, date, service_name, MeterSubCategory, resource_location);
