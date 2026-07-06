-- 20260706-002-support-attachments.sql
-- Adjuntos del sistema de soporte: jpg/jpeg/png/txt/json de hasta 5 MB por
-- archivo, almacenados en el filesystem local del contenedor (volumen
-- `support_uploads` en docker-compose) bajo SUPPORT_UPLOAD_DIR. La fila DB
-- guarda metadata + stored_name (UUID) — nunca el nombre original en disco.
-- Retención: 60 días (cron /api/cron/support-attachments-cleanup + limpieza
-- oportunista en cada upload).
CREATE TABLE IF NOT EXISTS SupportTicketAttachments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    uploaded_by_email VARCHAR(255) NOT NULL,
    uploaded_by_role ENUM('user', 'support') NOT NULL DEFAULT 'user',
    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(80) NOT NULL UNIQUE,
    mime_type VARCHAR(100) NOT NULL,
    size_bytes INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_support_att_ticket (ticket_id),
    INDEX idx_support_att_created (created_at),
    INDEX idx_support_att_tenant (tenant_id),
    FOREIGN KEY (ticket_id) REFERENCES SupportTickets(id) ON DELETE CASCADE
);
