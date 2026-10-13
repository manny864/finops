-- Solicitudes de cancelación que un SuperAdmin tiene que aprobar.
--
-- Cuando un cliente pide cancelar y la baja NO se puede ejecutar sola (el tenant no tiene suscripción de Paddle, factura por el
-- marketplace de Azure, o Paddle rechazó el pedido), antes sólo se marcaba `Tenants.cancel_at_period_end` y nadie se enteraba ni lo
-- ejecutaba. Ahora queda una solicitud PENDING que se avisa al SuperAdmin y que él aprueba o rechaza.
--
-- Una sola PENDING por tenant: lo garantiza el servicio con un INSERT ... WHERE NOT EXISTS, no un índice. No se usó una columna
-- generada con UNIQUE porque MySQL no admite CASCADE en la FK de la columna base de una generada STORED.
--
-- COLLATE explícito en `tenant_id` por la FK, igual que en 20261008-031.
CREATE TABLE IF NOT EXISTS CancellationRequests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci,
    requested_by VARCHAR(255) NOT NULL,
    reason_code ENUM('no-paddle-subscription', 'azure-marketplace', 'paddle-rejected') NOT NULL,
    detail VARCHAR(1000) NULL,
    status ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    effective_date DATE NULL,
    resolved_by VARCHAR(255) NULL,
    resolved_at TIMESTAMP NULL,
    resolution_note VARCHAR(1000) NULL,
    last_reminded_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_cancellation_tenant_status (tenant_id, status),
    KEY idx_cancellation_status_created (status, created_at),
    CONSTRAINT fk_cancellation_tenant FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
