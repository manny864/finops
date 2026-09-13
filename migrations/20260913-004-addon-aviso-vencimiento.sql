-- Aviso previo al vencimiento de un modulo comprado suelto.
--
-- `TenantAddons.status` tenia los tres valores ('active','expired','cancelled')
-- pero NADIE escribia 'expired': el corte de acceso funcionaba igual porque
-- `getActiveAddons` filtra por `expires_at > NOW()`, asi que la fila quedaba
-- marcada como activa para siempre aunque el pase ya no sirviera.
--
-- Lo que faltaba de verdad era el aviso: el cliente se enteraba de que se le
-- vencio el modulo cuando la pantalla dejo de abrir. Esta columna es la marca
-- anti-spam del cron `/api/cron/addon-expiry`, que avisa una sola vez por pase
-- cuando entra en la ventana de 7 dias.
ALTER TABLE TenantAddons
  ADD COLUMN expiry_notified_at DATETIME NULL DEFAULT NULL;
