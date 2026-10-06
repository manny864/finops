-- El comercial también tiene panel (2026-10-06), con el mismo tipo de enlace
-- que el afiliado: se guarda sólo el hash del token, y el panel junta a la
-- persona por email si además es afiliado (ver partnerPorToken).
ALTER TABLE SalesReps
  ADD COLUMN portal_token_hash CHAR(64) NULL,
  ADD COLUMN portal_token_prefix VARCHAR(20) NULL,
  ADD COLUMN portal_token_issued_at DATETIME NULL,
  ADD COLUMN portal_token_last_used_at DATETIME NULL;

CREATE UNIQUE INDEX uq_sales_rep_portal_token ON SalesReps (portal_token_hash);
