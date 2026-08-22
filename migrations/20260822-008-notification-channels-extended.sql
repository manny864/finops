-- Canales de notificación: tipo `webhook`, categorías de evento, rate limit y
-- resultado de la última entrega.
--
-- Se extiende `NotificationChannels` (20260728-003) en vez de crear tablas
-- nuevas: la tabla ya modela exactamente este concepto y la consume el motor de
-- despacho (`src/lib/notifications.ts`). Tampoco se crea
-- `NotificationDeliveryLogs`: `NotificationLog` (misma migración) ya guarda
-- tenant, canal, título, severidad, estado y error por envío.

-- El ENUM sólo aceptaba ('slack','teams','email'), así que un webhook genérico
-- (ServiceNow, PagerDuty, endpoint propio) no se podía ni guardar. Se agrega
-- 'webhook' conservando los tres valores existentes en minúscula — cambiarlos a
-- mayúscula obligaría a reescribir filas de producción y el switch del
-- dispatcher, sin ganancia funcional (mismo criterio que los ENUM de Soporte,
-- ver LLD §31).
ALTER TABLE NotificationChannels
    MODIFY COLUMN type ENUM('slack','teams','email','webhook') NOT NULL;

-- Categorías de evento suscritas. NULL = todas, que es el comportamiento previo
-- a esta migración: un canal existente no debe dejar de recibir nada por el solo
-- hecho de aplicarla.
ALTER TABLE NotificationChannels
    ADD COLUMN event_categories JSON NULL DEFAULT NULL;

-- 0 = sin agrupamiento (instantáneo), que es como se comporta hoy.
ALTER TABLE NotificationChannels
    ADD COLUMN rate_limit_minutes INT NOT NULL DEFAULT 0;

ALTER TABLE NotificationChannels
    ADD COLUMN last_delivered_at DATETIME NULL DEFAULT NULL;

ALTER TABLE NotificationChannels
    ADD COLUMN last_delivery_status ENUM('SUCCESS','FAILED') NULL DEFAULT NULL;

-- La UI cuenta los disparos de los últimos 30 días por tenant; sin índice es un
-- full scan de NotificationLog en cada carga de la pestaña.
CREATE INDEX idx_notificationlog_tenant_sent ON NotificationLog (tenant_id, sent_at);
