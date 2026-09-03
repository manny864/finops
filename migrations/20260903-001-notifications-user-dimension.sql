-- MEJ-33 paso 3: que un aviso pueda tener destinatario.
--
-- `Notifications` sólo tenía `tenant_id`, así que todo aviso le llegaba a TODOS
-- los usuarios del tenant — que operativamente es que no le llega a nadie. Es
-- la mitad que faltaba del lazo: los pasos 1 y 2 ya resuelven quién es el
-- responsable de un desvío, pero la notificación seguía siendo un altoparlante.
--
-- NULL = difusión a todo el tenant. Es el default a propósito:
--  - Las filas existentes quedan visibles para todos, sin backfill ni riesgo de
--    esconderle a alguien un aviso que ya tenía.
--  - Un aviso de plataforma (mantenimiento, reporte listo) es legítimamente
--    para todos; sólo lo que tiene dueño identificable se dirige.
--
-- Se guarda el EMAIL y no un id de Users: el dueño puede venir de la etiqueta
-- `Owner` de un recurso de Azure y no ser todavía usuario de la plataforma
-- (ver anomalyOwnerResolver). Perder esa dirigibilidad por no tener la fila
-- sería peor que guardar el texto.
ALTER TABLE Notifications
    ADD COLUMN user_email VARCHAR(320) NULL
    COMMENT 'MEJ-33: destinatario. NULL = todo el tenant';

-- El filtro de lectura es (tenant_id, user_email IS NULL OR user_email = ?),
-- así que el índice cubre las dos ramas.
ALTER TABLE Notifications
    ADD INDEX idx_notif_tenant_user (tenant_id, user_email);
