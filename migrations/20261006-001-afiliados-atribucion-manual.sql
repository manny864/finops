-- Atribución manual de un tenant a un afiliado desde Superadmin › Afiliados
-- (2026-10-06). Hasta ahora la única vía era el link (`?ref=`) en el alta, así
-- que el cliente que trajo un afiliado y se registró sin el link no le contaba.
--
-- `attributed_by` guarda el mail del superadmin que la hizo; NULL es una
-- atribución por link. No va a AuditTrailLogs a propósito: esa es la auditoría
-- del tenant y la leen sus propios admins, que no tienen por qué ver a qué
-- afiliado quedó atribuida su cuenta. `referred_at` ya dice cuándo.
ALTER TABLE AffiliateReferrals ADD COLUMN attributed_by VARCHAR(255) NULL AFTER referred_at;
