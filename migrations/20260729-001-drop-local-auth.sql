-- Se retira el login por email+contraseña (identidad propia, Fase 2 —
-- existía solo para tenants AWS, ver 20260725-004-local-auth.sql). Con AWS ya
-- removido (20260727-001) no queda ningún camino que cree usuarios locales;
-- se revierte el esquema.
--
-- Idempotente: DROP TABLE IF EXISTS no falla si ya se corrió antes. El
-- runner (src/modules/storage/migrations.ts) tolera ER_CANT_DROP_FIELD_OR_KEY
-- para las columnas/índice, así que correrla dos veces tampoco rompe.

DROP TABLE IF EXISTS AuthTokens;

ALTER TABLE Users DROP INDEX idx_email_tenant;
ALTER TABLE Users DROP COLUMN password_hash;
ALTER TABLE Users DROP COLUMN email_verified_at;
