-- Preservación del rastro de auditoría al purgar un tenant.
--
-- `ActionLogs` y `AuthAuditLogs` tenían FK a Tenants con ON DELETE CASCADE, así
-- que borrar la fila del tenant borraba también su bitácora completa — la baja
-- del entorno era justo el evento que quedaba sin rastro, y con él toda la
-- evidencia de lo que se hizo en ese tenant mientras existió.
--
-- Quitar la FK deja las filas huérfanas a propósito: el `tenant_id` ya no apunta
-- a nada y eso es correcto, porque el hecho auditado ocurrió cuando el tenant
-- existía. Las demás tablas conservan CASCADE: los datos operativos SÍ deben irse.
--
-- Se dropea por nombre porque MySQL no soporta DROP FOREIGN KEY IF EXISTS; el
-- runner tolera ER_CANT_DROP_FIELD_OR_KEY, así que reaplicarla es inocua.
-- (Nombres verificados contra information_schema: ambos son *_ibfk_1.)

ALTER TABLE ActionLogs DROP FOREIGN KEY ActionLogs_ibfk_1;

ALTER TABLE AuthAuditLogs DROP FOREIGN KEY AuthAuditLogs_ibfk_1;

-- Sin la FK se pierde el índice implícito que MySQL mantenía para validarla;
-- las consultas de auditoría filtran por tenant_id, así que se repone explícito.
CREATE INDEX idx_actionlogs_tenant ON ActionLogs (tenant_id);

CREATE INDEX idx_authauditlogs_tenant ON AuthAuditLogs (tenant_id);
