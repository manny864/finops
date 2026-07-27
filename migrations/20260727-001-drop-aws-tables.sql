-- El producto pasa a ser Azure-only: se remueve el subsistema AWS completo
-- (código + este drop de esquema). AwsAccounts guardaba la configuración de
-- assume-role + CUR S3 export por tenant; sin backend AWS no queda nada que
-- la lea ni la escriba.
--
-- Idempotente: DROP TABLE IF EXISTS no falla si ya se corrió antes.

DROP TABLE IF EXISTS AwsAccounts;
