-- Registro centralizado de corridas de cron para observabilidad SuperAdmin.
-- Permite ver estado/latencia por cron sin depender de inferencias indirectas.
CREATE TABLE IF NOT EXISTS SystemCronRuns (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cron_name VARCHAR(120) NOT NULL,
    status ENUM('ok', 'warning', 'error') NOT NULL DEFAULT 'ok',
    duration_ms INT NULL,
    summary VARCHAR(500) NULL,
    details JSON NULL,
    run_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cron_run_at (cron_name, run_at),
    INDEX idx_run_at (run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
