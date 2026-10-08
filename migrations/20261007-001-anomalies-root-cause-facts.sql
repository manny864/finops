-- Hechos de causa raíz de una anomalía (propuesta de IA, Fase 1a).
--
-- `top_contributors` dice qué resource group + servicio empujó el pico. Esto
-- agrega el paso siguiente: qué medidor dentro de ese servicio, y si subió el
-- consumo, el costo unitario o apareció algo nuevo. Lo calcula
-- src/services/anomalyRootCause.service.ts desde CostMeterSnapshots y es lo
-- único que puede citar la explicación con IA.
--
-- Idempotente: el runner ignora ER_DUP_FIELDNAME.
ALTER TABLE Anomalies
    ADD COLUMN root_cause_facts JSON NULL AFTER top_contributors;
