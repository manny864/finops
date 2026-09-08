-- Migration: 20260908-001-notifications-i18n-keys.sql
--
-- Las notificaciones in-app se guardaban con el texto ya armado, en castellano:
--
--     createNotification({ title: "Reporte ejecutivo listo", ... })
--
-- y el Centro de Acciones lo pintaba tal cual, así que en la UI en inglés la
-- bandeja salía en castellano.
--
-- Es un caso distinto del de los payloads cacheados que se corrigieron en el
-- mismo ciclo, y es peor: una entrada de cache expira y se rearma, **una fila de
-- Notifications es permanente**. Lo único que hay guardado de una notificación
-- vieja es su frase, así que no hay forma de retraducirla.
--
-- De ahí las tres decisiones de este esquema:
--
-- 1. Las columnas nuevas son NULL. Las filas históricas no se migran ni se
--    intentan traducir: se siguen mostrando con su texto original, que es la
--    verdad de cuando se crearon.
--
-- 2. `title` y `message` NO se vuelven opcionales, y se siguen escribiendo con
--    la frase en castellano. No es redundancia: es el fallback de la UI si
--    faltara la clave, y sobre todo es lo que consumen los caminos que NO son
--    la UI localizada — el push del navegador (`notifyTenant`), los webhooks y
--    el email, que no tienen un catálogo de next-intl a mano.
--
-- 3. `params_json` y no columnas por parámetro: cada notificación interpola lo
--    suyo (un monto, una fecha, un nombre de recurso) y no hay un conjunto
--    común que valga la pena normalizar.
--
-- El índice no se toca: nada filtra ni ordena por estas columnas.

ALTER TABLE Notifications
    ADD COLUMN title_key   VARCHAR(120) NULL COMMENT 'Clave i18n del titulo. NULL = fila historica, usar `title`.',
    ADD COLUMN message_key VARCHAR(120) NULL COMMENT 'Clave i18n del mensaje. NULL = fila historica, usar `message`.',
    ADD COLUMN params_json JSON         NULL COMMENT 'Valores a interpolar en las dos claves. Numeros y nombres, nunca frases.';
