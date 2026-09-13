-- Dónde queda registrada la baja pedida por el cliente.
--
-- `cancelTenantSubscription` escribía en `TenantSaaSSubscriptions`, una tabla
-- que no existe (sin DDL en el repo, sin ningún otro lector ni escritor), y el
-- fallback intentaba `UPDATE Tenants SET subscription_status='CANCELED_PENDING'
-- WHERE id = ?` -- con la clave equivocada (`Tenants.id` es un INT
-- autoincrement, la clave es `tenant_id`) y con un valor que el ENUM de esa
-- columna no admite. No persistía nada, y la función devolvía `success: true`
-- igual: el cliente pedía la baja y no quedaba registro en ninguna parte.
--
-- Va en `Tenants` porque es donde ya viven `tier` y `subscription_status`, que
-- es lo que el resto de la app lee para autorizar.
--
-- NO corta el acceso por sí sola: marca la intención para el fin del período.
-- El corte efectivo lo hace el webhook de Paddle cuando la suscripción se
-- cancela de verdad.
ALTER TABLE Tenants
  ADD COLUMN cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;
