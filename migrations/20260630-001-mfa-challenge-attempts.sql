-- Migration: 20260630-001-mfa-challenge-attempts.sql
-- Agrega columna attempt_count a MfaChallenges para rastrear
-- intentos fallidos y prevenir brute force de TOTP (C-03).
-- Idempotente: usa IF NOT EXISTS via columna.

ALTER TABLE MfaChallenges
  ADD COLUMN IF NOT EXISTS attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0;
