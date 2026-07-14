-- Evaluador real de detección de anomalías (cron /api/cron/anomaly-detection,
-- corre cada 5 min): antes la tabla Anomalies existía en el schema pero
-- nadie hacía INSERT — el endpoint on-demand calculaba todo al vuelo y
-- descartaba el resultado. Ahora se persiste, y notified_at evita
-- re-notificar la misma anomalía en cada corrida mientras siga apareciendo
-- en la ventana de detección de 30 días.
ALTER TABLE Anomalies
    ADD COLUMN notified_at TIMESTAMP NULL AFTER detected_at;

-- Idempotencia: correr la detección cada 5 min sobre la misma ventana no
-- debe crear filas duplicadas para el mismo día/suscripción — se actualiza
-- la existente (amount/z_score pueden variar levemente si CostSnapshots
-- todavía está recibiendo datos tardíos de Azure) en vez de insertar de nuevo.
ALTER TABLE Anomalies
    ADD UNIQUE KEY uq_anomaly_tenant_sub_date (tenant_id, subscription_id, date);
