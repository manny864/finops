-- Idempotencia del ingest de CUR.
--
-- AWS re-emite (restates) el CUR del periodo en curso varias veces al mes,
-- cada vez con un `assemblyId` nuevo en el manifest. Guardando el ultimo
-- assemblyId ingerido podemos cortar el sync ANTES de bajar un solo byte de
-- Parquet cuando no hay nada nuevo — que es la parte cara en tiempo y en
-- egress de la cuenta del cliente.

ALTER TABLE AwsAccounts ADD COLUMN last_assembly_id VARCHAR(128) NULL;
