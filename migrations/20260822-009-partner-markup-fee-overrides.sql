-- Motor de facturación de partner (CSP): tarifa fija de gestión, interruptor de
-- markup y reglas de excepción por alcance.
--
-- `markup_percentage DECIMAL(5,2)` ya existe en `Tenants` desde 20260705-001 y
-- se conserva como está: es la fuente de verdad del porcentaje global y ya la
-- leen /api/admin/billing-markup y el motor de facturación. Se le suman dos
-- columnas 1:1 en la misma tabla en vez de crear `TenantMarkupSettings`, por el
-- mismo criterio del resto de la configuración de tenant.
--
-- Ojo con el tipo: DECIMAL(5,2) sirve para un porcentaje (máx. 999.99) pero NO
-- para un importe, así que la tarifa fija necesita su propia columna ancha.

-- Tarifa fija mensual de gestión, en USD. DECIMAL y no float: Regla Cero.
ALTER TABLE Tenants
    ADD COLUMN management_fee_usd DECIMAL(12,2) NOT NULL DEFAULT 0.00;

-- Permite apagar el markup sin perder el porcentaje configurado (mismo patrón
-- que el interruptor maestro de notificaciones). TRUE por default para no
-- cambiar el comportamiento de los tenants que ya tienen markup cargado.
ALTER TABLE Tenants
    ADD COLUMN markup_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Reglas de excepción: acá SÍ corresponde una tabla nueva. La relación es 1:N
-- (un tenant tiene N reglas), a diferencia de la configuración global que es
-- 1:1 y por eso vive en columnas de `Tenants`.
--
-- Caso de uso típico: no cobrar margen sobre Marketplace o sobre una suscripción
-- que el cliente paga directo.
CREATE TABLE IF NOT EXISTS MarkupOverrideRules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    rule_name VARCHAR(128) NOT NULL,
    scope_type ENUM('SUBSCRIPTION','SERVICE_CATEGORY') NOT NULL,
    -- GUID de suscripción o nombre de categoría de servicio, según scope_type.
    scope_value VARCHAR(255) NOT NULL,
    -- 0.00 es un valor legítimo y frecuente: pass-through sin margen.
    override_percentage DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_email VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    -- Dos reglas para el mismo alcance harían el margen dependiente del orden
    -- de lectura; se prohíbe en la base y no sólo en la UI.
    UNIQUE KEY uniq_tenant_scope (tenant_id, scope_type, scope_value),
    INDEX idx_tenant_enabled (tenant_id, is_enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
