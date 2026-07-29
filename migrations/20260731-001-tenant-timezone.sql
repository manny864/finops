-- Zona horaria por tenant.
--
-- Motivación doble:
--
-- 1. El wizard de onboarding YA pide la zona horaria (`timezone` en
--    src/app/[locale]/onboarding/page.tsx) y nunca la enviaba al backend: no
--    existía columna donde guardarla. Era estado muerto de la UI.
--
-- 2. PowerSchedules guarda un OFFSET FIJO (`gmt_offset`, ej. '+02:00')
--    capturado del navegador al momento de guardar. Contempla el horario de
--    verano vigente en ese instante y después queda congelado: un horario
--    guardado en Madrid en julio (+02:00) apaga las VMs una hora antes desde
--    noviembre. Guardando el nombre IANA de la zona, el offset se recalcula en
--    cada ejecución y el DST deja de ser un problema.
--
-- Se usan nombres IANA (America/Argentina/Buenos_Aires), no offsets: un offset
-- no identifica una zona y no sabe de DST.

ALTER TABLE Tenants
  ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'America/Argentina/Buenos_Aires'
  COMMENT 'Nombre IANA. Gobierna cómo se muestran las fechas y el default de PowerSchedules.';

-- NULL a propósito, no un default: no se puede derivar la zona IANA desde un
-- offset fijo (-03:00 es Buenos Aires, Montevideo, Santiago o São Paulo). Las
-- filas que queden en NULL siguen usando gmt_offset con el comportamiento
-- viejo hasta que alguien las edite — sin cambios silenciosos de horario en
-- schedules que hoy funcionan.
ALTER TABLE PowerSchedules
  ADD COLUMN timezone VARCHAR(64) NULL
  COMMENT 'Nombre IANA. Si está seteada, gana sobre gmt_offset (que no contempla DST).';

-- Backfill conservador: sólo las filas cuyo offset guardado coincide con el
-- offset que hoy tiene la zona del tenant. Ahí la zona es casi con certeza la
-- misma y convertirla no cambia ningún horario. El resto queda para revisión
-- manual, listable con la consulta del final.
UPDATE PowerSchedules ps
  JOIN Tenants t ON t.tenant_id = ps.tenant_id
SET ps.timezone = t.timezone
WHERE ps.timezone IS NULL
  AND ps.gmt_offset = CONCAT(
        IF(TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), CONVERT_TZ(UTC_TIMESTAMP(), 'UTC', t.timezone)) < 0, '-', '+'),
        LPAD(FLOOR(ABS(TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), CONVERT_TZ(UTC_TIMESTAMP(), 'UTC', t.timezone))) / 3600), 2, '0'),
        ':',
        LPAD(FLOOR((ABS(TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), CONVERT_TZ(UTC_TIMESTAMP(), 'UTC', t.timezone))) % 3600) / 60), 2, '0')
      );

-- OJO: CONVERT_TZ devuelve NULL si el servidor MySQL no tiene cargadas las
-- tablas de zonas horarias (mysql.time_zone_name). En ese caso este UPDATE no
-- convierte nada y todas las filas quedan en NULL — que es el lado seguro. En
-- MySQL Flexible Server de Azure las tablas vienen cargadas.
--
-- Filas que quedaron sin zona y hay que revisar a mano:
--
--   SELECT ps.id, ps.tenant_id, ps.vm_name, ps.shutdown_time, ps.gmt_offset
--   FROM PowerSchedules ps
--   WHERE ps.timezone IS NULL AND ps.enabled = 1;
