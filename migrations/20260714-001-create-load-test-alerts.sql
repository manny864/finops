-- Prueba de carga (superadmin) + alertas de sistema por alta concurrencia.
CREATE TABLE IF NOT EXISTS LoadTestRuns (
    id INT AUTO_INCREMENT PRIMARY KEY,
    target_endpoint VARCHAR(255) NOT NULL,
    concurrency INT NOT NULL,
    duration_ms INT NOT NULL,
    total_requests INT NOT NULL,
    success_count INT NOT NULL,
    error_count INT NOT NULL,
    p50_ms INT NOT NULL,
    p95_ms INT NOT NULL,
    p99_ms INT NOT NULL,
    max_ms INT NOT NULL,
    throughput_rps DECIMAL(10,2) NOT NULL,
    triggered_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_load_test_created (created_at)
);

CREATE TABLE IF NOT EXISTS SystemAlerts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    severity ENUM('warning','critical') NOT NULL,
    source VARCHAR(50) NOT NULL,
    message VARCHAR(1000) NOT NULL,
    detail JSON NULL,
    load_test_run_id INT NULL,
    acknowledged_at TIMESTAMP NULL,
    acknowledged_by VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_system_alerts_created (created_at),
    INDEX idx_system_alerts_ack (acknowledged_at),
    FOREIGN KEY (load_test_run_id) REFERENCES LoadTestRuns(id) ON DELETE SET NULL
);
