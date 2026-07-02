-- Migration: 20260630-001-mfa-challenge-attempts.sql
-- Agrega columna attempt_count a MfaChallenges para rastrear
-- intentos fallidos y prevenir brute force de TOTP (C-03).
-- Idempotencia: MySQL no soporta `ADD COLUMN IF NOT EXISTS` (es sintaxis
-- MariaDB). El migration runner trata ER_DUP_FIELDNAME como idempotente,
-- así que un ADD COLUMN plano es seguro en reejecuciones.

ALTER TABLE MfaChallenges
  ADD COLUMN attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0;
