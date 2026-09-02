-- MEJ-33 paso 2: a quién le corresponde el desvío.
--
-- La asignación se DERIVA del modelo de gobernanza que el cliente ya definió
-- (Cost Groups con dueño, o la etiqueta Owner), no de un motor propio que
-- adivine. Por eso se guarda también POR QUÉ VÍA se resolvió: una asignación
-- que el usuario no puede explicar es una que va a ignorar.
--
-- `assigned_to` es un email y no una FK a Users: la etiqueta Owner de Azure
-- puede traer un correo que todavía no es usuario de la plataforma, y perder esa
-- información por no tener la fila sería peor que guardarla suelta.
ALTER TABLE Anomalies
    ADD COLUMN assigned_to VARCHAR(320) NULL COMMENT 'MEJ-33: email del responsable derivado de la gobernanza del cliente',
    ADD COLUMN assigned_via ENUM('cost_group_membership','cost_group_pattern','cost_group_tag','owner_tag') NULL COMMENT 'MEJ-33: por qué vía se resolvió, para que la asignación sea auditable',
    ADD COLUMN assigned_detail VARCHAR(255) NULL COMMENT 'MEJ-33: qué grupo o etiqueta concreta lo resolvió';

ALTER TABLE Anomalies ADD INDEX idx_anomaly_assigned (tenant_id, assigned_to);
