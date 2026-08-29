-- MEJ-25: Desvincular una suscripción Azure desde Cuentas Cloud.
--
-- La lista de suscripciones NO es una tabla de vínculos: se descubre en cada
-- sync (Management API + TenantDelegations + los subscription_id que ya hay en
-- CostSnapshots). Por eso "eliminar" es una EXCLUSIÓN persistente: sin esta
-- tabla, borrar filas sólo hace que la suscripción reaparezca en el siguiente
-- ciclo de ingesta.
--
-- El histórico de CostSnapshots se conserva a propósito: el gasto de meses
-- cerrados es información contable y borrarlo cambiaría reportes ya exportados.

-- Sin FOREIGN KEY a Tenants(tenant_id) a propósito: esa columna tiene
-- colación distinta entre entornos (utf8mb4_unicode_ci vs utf8mb4_0900_ai_ci
-- según cuándo se creó la base), y una FK con colación incompatible aborta el
-- CREATE TABLE entero con el error 3780 — que además no es idempotente para
-- el runner, así que bloqueaba TODAS las migraciones siguientes. Un tenant
-- borrado dejando una fila huérfana acá es inofensivo: nunca se consulta esta
-- tabla sin filtrar por tenant_id.
CREATE TABLE IF NOT EXISTS TenantExcludedSubscriptions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    subscription_id VARCHAR(100) NOT NULL,
    excluded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    excluded_by_email VARCHAR(255) NOT NULL,
    reason VARCHAR(500) NULL,
    -- Revincular es borrar esta fila; el UNIQUE hace idempotente el alta.
    UNIQUE KEY uq_excluded_subscription (tenant_id, subscription_id),
    INDEX idx_excluded_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
