-- Migration: 20260701-001-actionlogs-resource-type-details
-- Add missing columns to ActionLogs required by /api/intelligence/maturity POST.
-- Original CREATE TABLE omitted resource_type, details, and set action_type VARCHAR(50)
-- which is too short for values like 'MaturityAssessmentCompleted'.
--
-- Tables modified: ActionLogs
-- Idempotent: migration runner treats ER_DUP_FIELDNAME as success (column already exists).
-- NOTE: MySQL 5.7 does NOT support ADD COLUMN IF NOT EXISTS syntax — omitted intentionally.

ALTER TABLE ActionLogs
  ADD COLUMN resource_type VARCHAR(120) NOT NULL DEFAULT '' AFTER resource_id;

ALTER TABLE ActionLogs
  ADD COLUMN details TEXT NULL AFTER status;

-- Widen action_type from VARCHAR(50) to VARCHAR(120) to fit longer action names.
ALTER TABLE ActionLogs
  MODIFY COLUMN action_type VARCHAR(120) NOT NULL;
