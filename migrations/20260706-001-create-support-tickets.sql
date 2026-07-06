-- 20260706-001-create-support-tickets.sql
-- Sistema de soporte interno: los usuarios de cada tenant abren tickets que el
-- equipo de CSCloudSolutions (superadmins) atiende desde /superadmin/support.
-- Disponible desde el tier Essential, con cuota mensual de tickets por tier
-- (ver src/lib/supportConfig.ts).
--
-- Dos tablas:
--   SupportTickets        — el ticket (subject, status, priority, categoría).
--   SupportTicketMessages — hilo de conversación (usuario <-> soporte).
--
-- Idempotente: IF NOT EXISTS. FK a Tenants en paridad con Budgets/AlertRules.
CREATE TABLE IF NOT EXISTS SupportTickets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    category ENUM('technical', 'billing', 'question', 'feature_request') NOT NULL DEFAULT 'question',
    status ENUM('open', 'in_progress', 'waiting_customer', 'resolved', 'closed') NOT NULL DEFAULT 'open',
    priority ENUM('low', 'medium', 'high', 'urgent') NOT NULL DEFAULT 'medium',
    created_by_email VARCHAR(255) NOT NULL,
    created_by_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_support_tenant_status (tenant_id, status),
    INDEX idx_support_status_updated (status, last_message_at),
    INDEX idx_support_tenant_created (tenant_id, created_at),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS SupportTicketMessages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    author_email VARCHAR(255) NOT NULL,
    author_name VARCHAR(255),
    author_role ENUM('user', 'support') NOT NULL DEFAULT 'user',
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_support_msg_ticket (ticket_id, created_at),
    FOREIGN KEY (ticket_id) REFERENCES SupportTickets(id) ON DELETE CASCADE
);
