-- Histórico del consumo de las APIs de Azure.
--
-- La telemetría vive en Redis (`azureapi:v1:<hora>:<servicio>:<tenant>:<op>`) y
-- eso alcanza para diagnosticar un incidente del día, pero no para más:
--
--  * el cache NO tiene persistencia (`rdbEnabled=false`, `aofEnabled=false`),
--    así que un reinicio se lleva todo;
--  * la política es `AllKeysLRU`, o sea que si la memoria se llena desaloja
--    claves aunque no hayan vencido;
--  * y el TTL es de 8 días, con lo cual no hay forma de comparar un mes contra
--    otro ni de conservar evidencia después de un incidente.
--
-- Esta tabla es el volcado horario de esos contadores. La clave primaria es la
-- misma tupla que la clave de Redis, así que el cron puede correr dos veces
-- sobre la misma hora sin duplicar: el UPSERT pisa con el valor acumulado, que
-- es siempre el más completo.
CREATE TABLE IF NOT EXISTS AzureApiUsageHourly (
    hora CHAR(13) NOT NULL COMMENT 'YYYY-MM-DDTHH, la ventana de agregación',
    servicio VARCHAR(64) NOT NULL COMMENT 'BillingService, ARG…',
    tenant_id VARCHAR(255) NOT NULL COMMENT 'sin-tenant para las llamadas que no lo informan',
    operacion VARCHAR(80) NOT NULL COMMENT 'cost-mtd, historical, forecast…',
    llamadas INT UNSIGNED NOT NULL DEFAULT 0,
    ok INT UNSIGNED NOT NULL DEFAULT 0,
    throttle INT UNSIGNED NOT NULL DEFAULT 0,
    error INT UNSIGNED NOT NULL DEFAULT 0,
    -- El tiempo perdido esperando es el costo real del throttling: la llamada
    -- no se pierde, se demora. BIGINT porque un día malo acumula millones.
    espera_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
    volcado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    -- SIN FK a Tenants, a diferencia del resto de las tablas con `tenant_id`:
    -- acá la columna guarda 'sin-tenant' para las llamadas que no lo informan
    -- --no sería una clave válida-- y, sobre todo, el histórico TIENE que
    -- sobrevivir a la baja del cliente: si se va un tenant, sigue haciendo falta
    -- poder explicar el throttling de ese período. Está anotado como excepción
    -- en el test de cascada de borrado.
    PRIMARY KEY (hora, servicio, tenant_id, operacion),
    KEY idx_uso_api_hora (hora),
    KEY idx_uso_api_tenant (tenant_id, hora)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
