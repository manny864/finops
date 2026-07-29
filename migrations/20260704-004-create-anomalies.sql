-- Migration: 20260704-004-create-anomalies.sql
-- Crea Anomalies: desvíos de costo detectados por Z-Score.
--
-- Igual que MfaChallenges (ver 20260629-008): la tabla nunca se creó por
-- migración, existía sólo en el VPS hecha a mano. Las migraciones que le hacen
-- ALTER (20260714-005 y 20260716-002) funcionaban ahí y fallan con
-- ER_NO_SUCH_TABLE en cualquier base nueva. Verificado 2026-07-28.
--
-- El nombre la ordena antes de esos dos ALTER.
--
-- NO se incluyen acá las columnas que agregan esas migraciones posteriores
-- (notified_at, top_contributors) ni su UNIQUE KEY: duplicarlas haría divergir
-- las definiciones. Sí se incluye detected_at, porque 20260714-005 la usa como
-- ancla (`ADD COLUMN notified_at ... AFTER detected_at`).
--
-- Esquema derivado del uso real en src/ (INSERT de la detección de anomalías,
-- y los SELECT/UPDATE del cron de notificación).

CREATE TABLE IF NOT EXISTS Anomalies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    -- ascii: es un GUID de suscripción de Azure, mismo criterio que en
    -- CostSnapshots. Sin FK, así que no arrastra a otras tablas.
    subscription_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL DEFAULT 'default',
    date DATE NOT NULL,
    -- Mismo tipo que cost_usd en CostSnapshots: son montos comparables.
    amount DECIMAL(12, 4) NOT NULL,
    expected_amount DECIMAL(12, 4) NOT NULL,
    z_score DECIMAL(10, 4) NOT NULL,
    -- 'open' | 'dismissed' (los dos únicos valores que escribe la app).
    status VARCHAR(32) NOT NULL DEFAULT 'open',
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_anomalies_tenant_date (tenant_id, date),
    -- El cron de notificación barre por notified_at IS NULL sobre las abiertas.
    INDEX idx_anomalies_status (status),

    CONSTRAINT fk_anomalies_tenant
        FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
);
