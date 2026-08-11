CREATE TABLE IF NOT EXISTS ExecutiveReportJobs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    requested_by_email VARCHAR(255) NOT NULL,
    scope_subscription_id VARCHAR(100) NOT NULL DEFAULT 'All',
    scope_subscription_name VARCHAR(255) NOT NULL DEFAULT 'Tenant completo',
    locale VARCHAR(10) NOT NULL DEFAULT 'es',
    status ENUM('queued','processing','completed','failed') NOT NULL DEFAULT 'queued',
    report_markdown MEDIUMTEXT NULL,
    error_message TEXT NULL,
    started_at DATETIME NULL,
    completed_at DATETIME NULL,
    emailed_to_requester_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_exec_report_jobs_tenant_created (tenant_id, created_at),
    INDEX idx_exec_report_jobs_lookup (tenant_id, requested_by_email, scope_subscription_id, id),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
);
