-- Propuesta de IA, Fase 3b: borradores de respuesta de soporte con IA.
--
-- Una fila por borrador que pidió un operador. El texto vive en la nota interna
-- que lo guarda (message_id, en SupportTicketMessages); acá queda qué secciones
-- del manual citó, con qué modelo, quién lo pidió y si se usó.
--
-- "Usado" = el operador lo pasó a la caja de respuesta ("Usar como respuesta")
-- y lo envió al cliente, editado o no: el POST del mensaje sella used_at.
--
-- Sin tenant_id: el tenant se alcanza por SupportTickets, que ya cuelga de
-- Tenants con ON DELETE CASCADE (cascadaBorradoTenant.test).

CREATE TABLE IF NOT EXISTS SupportTicketAiDrafts (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    message_id INT NULL,
    citations JSON NOT NULL,
    model_name VARCHAR(100) NULL,
    created_by VARCHAR(320) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_at DATETIME NULL,

    INDEX idx_support_ai_drafts_ticket (ticket_id, created_at),
    INDEX idx_support_ai_drafts_created (created_at),

    CONSTRAINT fk_support_ai_drafts_ticket
        FOREIGN KEY (ticket_id) REFERENCES SupportTickets(id) ON DELETE CASCADE,
    CONSTRAINT fk_support_ai_drafts_message
        FOREIGN KEY (message_id) REFERENCES SupportTicketMessages(id) ON DELETE SET NULL
);
