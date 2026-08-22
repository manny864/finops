-- Soporte: SLA de primera respuesta, asignación de agente, módulo relacionado
-- y notas internas privadas.
--
-- Idempotencia: MySQL 8 no soporta `ADD COLUMN IF NOT EXISTS`. El runner
-- (`src/modules/storage/migrations.ts`) tolera ER_DUP_FIELDNAME y
-- ER_DUP_KEYNAME, así que un ALTER repetido no rompe la corrida. Una sentencia
-- por línea terminada en `;` + salto: el runner parte los archivos así y un
-- statement compuesto en una sola línea llega junto a pool.query().

ALTER TABLE SupportTickets ADD COLUMN sla_deadline DATETIME NULL;
ALTER TABLE SupportTickets ADD COLUMN first_responded_at DATETIME NULL;
ALTER TABLE SupportTickets ADD COLUMN resolved_at DATETIME NULL;
ALTER TABLE SupportTickets ADD COLUMN assigned_admin_email VARCHAR(255) NULL;
ALTER TABLE SupportTickets ADD COLUMN related_module VARCHAR(64) NULL;

-- La cola global de superadmin filtra por "sin asignar" y ordena por riesgo de
-- SLA: sin estos índices son dos full scans sobre toda la tabla.
ALTER TABLE SupportTickets ADD INDEX idx_support_assigned (assigned_admin_email, status);
ALTER TABLE SupportTickets ADD INDEX idx_support_sla (status, sla_deadline);

-- Nota interna: visible sólo para el equipo de CSCloudSolutions. Default 0 para
-- que todo mensaje existente siga siendo público, que es lo que era.
ALTER TABLE SupportTicketMessages ADD COLUMN is_internal_note TINYINT(1) NOT NULL DEFAULT 0;

-- 'system' habilita mensajes generados por la plataforma (cambios de estado,
-- avisos de SLA) sin hacerlos pasar por un agente humano inexistente.
ALTER TABLE SupportTicketMessages MODIFY COLUMN author_role ENUM('user', 'support', 'system') NOT NULL DEFAULT 'user';

-- Los adjuntos hoy cuelgan del ticket. Con message_id se pueden mostrar dentro
-- de la burbuja del mensaje que los trajo; las filas viejas quedan en NULL y se
-- siguen listando a nivel ticket.
ALTER TABLE SupportTicketAttachments ADD COLUMN message_id INT NULL;
ALTER TABLE SupportTicketAttachments ADD INDEX idx_support_att_message (message_id);

-- Backfill del deadline para los tickets ya existentes: 4 h desde la creación,
-- que es el SLA de Enterprise y el piso que comunica la UI. El servicio recalcula
-- por tier cuando la columna está en NULL, así que esto sólo fija los que ya
-- vencieron su ventana.
UPDATE SupportTickets SET sla_deadline = DATE_ADD(created_at, INTERVAL 4 HOUR) WHERE sla_deadline IS NULL;

-- Primera respuesta: se deriva del primer mensaje de soporte de cada ticket.
-- Sin esto todos los tickets históricos figurarían como "sin responder" y el KPI
-- de riesgo de SLA arrancaría inflado.
UPDATE SupportTickets t SET t.first_responded_at = (SELECT MIN(m.created_at) FROM SupportTicketMessages m WHERE m.ticket_id = t.id AND m.author_role = 'support') WHERE t.first_responded_at IS NULL;

-- Resolución: los tickets ya cerrados o resueltos toman su última actualización
-- como fecha de resolución, que es la mejor aproximación disponible.
UPDATE SupportTickets SET resolved_at = last_message_at WHERE resolved_at IS NULL AND status IN ('resolved', 'closed');
