-- Aviso previo al vencimiento de un modulo comprado suelto.
--
-- `TenantAddons.status` tenia los tres valores ('active','expired','cancelled')
-- pero NADIE escribia 'expired': el corte de acceso funcionaba igual porque
-- `getActiveAddons` filtra por `expires_at > NOW()`, asi que la fila quedaba
-- marcada como activa para siempre aunque el pase ya no sirviera.
--
-- Lo que faltaba de verdad era el aviso: el cliente se enteraba de que se le
-- vencio el modulo cuando la pantalla dejo de abrir. Esta columna es la marca
-- anti-spam del cron `/api/cron/addon-expiry`, que avisa una sola vez por pase
-- cuando entra en la ventana de 7 dias.
-- POR QUÉ EMPIEZA CON UN CREATE Y NO CON EL ALTER
-- `TenantAddons` no la crea ninguna migración: la crea `ensureTableExists()` del
-- servicio, la primera vez que alguien abre el marketplace. O sea que existe en
-- los entornos donde ya se usó y NO existe en los demás — en producción no
-- estaba, y el ALTER murió con ER_NO_SUCH_TABLE dejando el deploy en rojo.
--
-- El DDL es el mismo que el del servicio, con la columna nueva incluida. Así la
-- tabla queda igual venga de donde venga, y el ALTER de abajo sólo hace trabajo
-- en los entornos donde la tabla ya existía sin la columna (el runner ignora su
-- ER_DUP_FIELDNAME cuando ya está).
CREATE TABLE IF NOT EXISTS TenantAddons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    addon_key VARCHAR(100) NOT NULL,
    addon_type ENUM('recurring', 'pass') NOT NULL DEFAULT 'pass',
    status ENUM('active', 'expired', 'cancelled') NOT NULL DEFAULT 'active',
    quantity INT NOT NULL DEFAULT 1,
    starts_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NULL,
    paddle_subscription_id VARCHAR(255) NULL,
    paddle_transaction_id VARCHAR(255) NULL,
    expiry_notified_at DATETIME NULL DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tenant_status_expires (tenant_id, status, expires_at),
    -- La FK no la tenía el DDL del servicio, y al entrar la tabla al corpus de
    -- migraciones quedó a la vista: sin esto, los add-ons de un tenant borrado
    -- sobreviven al tenant y quedan inalcanzables (ver el test de cascada).
    CONSTRAINT fk_tenant_addons FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE TenantAddons
  ADD COLUMN expiry_notified_at DATETIME NULL DEFAULT NULL;

-- Y la FK para los entornos donde la tabla ya existía sin ella (la creó el
-- servicio, no una migración). Si ya está, el runner ignora su ER_FK_DUP_NAME.
ALTER TABLE TenantAddons
  ADD CONSTRAINT fk_tenant_addons FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE;
