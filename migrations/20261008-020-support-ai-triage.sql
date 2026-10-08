-- Propuesta de IA, Fase 3a: triaje de tickets de soporte con IA.
--
-- Una fila por ticket con la sugerencia del modelo, en los valores del dominio
-- (TicketPriority, TicketCategory y TICKET_RELATED_MODULES). Es sólo una
-- sugerencia para el operador de /superadmin/support: nunca toca priority ni
-- sla_deadline del ticket. Aceptarla pasa por el mismo PATCH que el cambio
-- manual y sella accepted_*; descartarla sella dismissed_*.
--
-- Sin tenant_id: el tenant se alcanza por SupportTickets, que ya cuelga de
-- Tenants con ON DELETE CASCADE (cascadaBorradoTenant.test).

CREATE TABLE IF NOT EXISTS SupportTicketAiTriage (
    ticket_id INT NOT NULL PRIMARY KEY,
    suggested_priority VARCHAR(16) NOT NULL,
    suggested_category VARCHAR(32) NOT NULL,
    suggested_module VARCHAR(64) NULL,
    production_impact TINYINT(1) NOT NULL DEFAULT 0,
    rationale VARCHAR(500) NOT NULL,
    confidence DECIMAL(3,2) NOT NULL,
    model_name VARCHAR(100) NULL,
    accepted_by VARCHAR(320) NULL,
    accepted_at DATETIME NULL,
    dismissed_by VARCHAR(320) NULL,
    dismissed_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_support_ai_triage_ticket
        FOREIGN KEY (ticket_id) REFERENCES SupportTickets(id) ON DELETE CASCADE
);
