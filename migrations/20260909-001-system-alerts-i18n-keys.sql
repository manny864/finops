-- Migration: 20260909-001-system-alerts-i18n-keys.sql
--
-- Mismo caso que 20260908-001 pero en la otra tabla que guarda frases hechas:
-- SystemAlerts. La escriben dos lugares (`src/lib/loadTester.ts` y el cron
-- `cost-sync-staleness-check`), siempre con el texto ya armado en castellano:
--
--     `Prueba de carga contra "..." (concurrencia 25) detecto p95 3534ms.`
--
-- y el panel de SuperAdmin lo pinta tal cual, asi que con la UI en ingles la
-- tabla de alertas salia en castellano.
--
-- Las tres decisiones son las mismas que en Notifications, por las mismas
-- razones, asi que aca solo se anota lo que cambia:
--
-- 1. Columnas NULL, sin backfill. Una fila de SystemAlerts es historia: dice lo
--    que se detecto y cuando. Retraducirla seria reescribir el registro.
--
-- 2. `message` sigue siendo obligatorio y en castellano. Aca pesa mas que en
--    Notifications: es lo que viaja en el asunto y el cuerpo del mail de alerta
--    critica (`getCriticalSystemAlertEmailHtml`), que no tiene catalogo de
--    next-intl a mano y sale antes de que nadie abra el panel.
--
-- 3. `params_json` y no columnas por parametro: load_test interpola target,
--    concurrencia y latencia; cost_sync_staleness interpola conteos de tenants.
--    No hay conjunto comun que valga la pena normalizar.
--
-- El indice no se toca: nada filtra ni ordena por estas columnas. `source` sigue
-- siendo el discriminador de la alerta; `message_key` es solo el rotulo.

ALTER TABLE SystemAlerts
    ADD COLUMN message_key VARCHAR(120) NULL COMMENT 'Clave i18n del mensaje. NULL = fila historica, usar `message`.',
    ADD COLUMN params_json JSON         NULL COMMENT 'Valores a interpolar en la clave. Numeros y nombres, nunca frases.';
