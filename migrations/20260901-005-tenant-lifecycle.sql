-- MEJ-12: trazabilidad del ciclo de vida de un tenant.
--
-- POR QUÉ COLUMNAS *Y* TABLA DE EVENTOS, SI UNA SE DERIVA DE LA OTRA
-- No es redundancia: responden preguntas distintas.
--  - Las columnas son el ESTADO ACTUAL. El panel lista y filtra tenants por
--    fecha de alta o de baja; derivarlas del log pediría una subconsulta por
--    tenant en cada listado.
--  - `TenantLifecycleEvents` es la HISTORIA. Un tenant que se da de alta, se
--    va y vuelve tiene una sola `activated_at` (la última) pero varios
--    períodos, y el análisis de cohortes y de churn necesita los períodos, no
--    el último valor.
--
-- Es la decisión opuesta a la de MEJ-11 (donde `displayStatus` se deriva y no
-- se persiste) y por el motivo opuesto: allá el valor derivado se recalcula con
-- una comparación de fechas y materializarlo habría exigido un cron para
-- mantenerlo sincronizado; acá el dato es un HECHO con su momento, que no se
-- puede recomputar más tarde a partir del estado actual.
--
-- Sin FOREIGN KEY a Tenants: la colación de `Tenants.tenant_id` difiere entre
-- entornos y un error 3780 aborta el CREATE TABLE, trabando toda la corrida.

ALTER TABLE Tenants
    ADD COLUMN activated_at DATETIME NULL COMMENT 'MEJ-12: alta efectiva (onboarding completo o primer pago)',
    ADD COLUMN suspended_at DATETIME NULL COMMENT 'MEJ-12: suspensión (impago o acción administrativa)',
    ADD COLUMN canceled_at DATETIME NULL COMMENT 'MEJ-12: baja definitiva',
    ADD COLUMN cancellation_reason ENUM('voluntary_churn','payment_delinquency','contract_expired','admin_deprovisioning') NULL;

-- Índice para el filtro por rango de fechas del panel.
ALTER TABLE Tenants
    ADD INDEX idx_tenant_lifecycle_dates (activated_at, canceled_at);

CREATE TABLE IF NOT EXISTS TenantLifecycleEvents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    event_type ENUM('ACTIVATED','SUSPENDED','REACTIVATED','CANCELED','EXPIRED') NOT NULL,
    occurred_at DATETIME NOT NULL,
    -- Quién lo provocó: el email de un SuperAdmin, o el origen automático
    -- ('paddle-webhook', 'marketplace-webhook', 'cron-trial-expiry'). Texto y
    -- no FK a Users: la mayoría de las transiciones no las hace una persona.
    actor VARCHAR(320) NOT NULL DEFAULT 'system',
    reason ENUM('voluntary_churn','payment_delinquency','contract_expired','admin_deprovisioning') NULL,
    -- Estado anterior y nuevo: permite reconstruir la línea de tiempo sin
    -- tener que inferirla del orden de las filas.
    previous_status VARCHAR(32) NULL,
    new_status VARCHAR(32) NULL,
    metadata JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tenant_occurred (tenant_id, occurred_at),
    INDEX idx_event_type_occurred (event_type, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- BACKFILL de los tenants que ya existen.
--
-- `created_at` es lo mejor disponible como aproximación del alta: es la fecha
-- en que se creó el registro, no la del onboarding efectivo ni la del primer
-- pago. Para los tenants anteriores a esta migración esa distinción se perdió
-- y no hay forma de recuperarla; se documenta acá para que nadie lea esas
-- fechas como si fueran exactas.
--
-- Sólo se estampa a los que hoy están vigentes: un tenant ya cancelado tendría
-- que llevar además `canceled_at`, y esa fecha directamente no existe en
-- ningún lado (justamente el hueco que MEJ-12 viene a tapar).
UPDATE Tenants
   SET activated_at = created_at
 WHERE activated_at IS NULL
   AND subscription_status IN ('ACTIVE', 'TRIAL');
