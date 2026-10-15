-- PERIM-08 — Inbox durable y cursor de orden para webhooks (Paddle, Azure Marketplace).
--
-- WebhookInbox: un evento ya procesado (o descartado por viejo) no vuelve a aplicarse.
-- La fila se escribe en la MISMA transacción que bloquea el cursor y sólo se confirma
-- cuando el handler terminó bien: si falla, rollback y el proveedor reintenta.
-- No guarda el payload: el inbox es para deduplicar, no un archivo de datos de cliente.
--
-- WebhookResourceCursor: último `occurred_at` aplicado por suscripción y ámbito. La fila
-- se bloquea con FOR UPDATE mientras se procesa un evento, lo que además serializa las
-- entregas concurrentes del mismo recurso.
--
-- Retención: no hay purga. Si se agrega, no borrar filas más nuevas que el horizonte de
-- reentrega de los proveedores (Paddle reintenta hasta 3 días).

CREATE TABLE IF NOT EXISTS WebhookInbox (
    provider VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    cursor_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    occurred_at DATETIME(3) NULL,
    outcome VARCHAR(16) NOT NULL,
    processed_at DATETIME(3) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (provider, event_id),
    INDEX idx_webhookinbox_processed (processed_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS WebhookResourceCursor (
    provider VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    cursor_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    last_occurred_at DATETIME(3) NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (provider, cursor_key)
) ENGINE=InnoDB;
