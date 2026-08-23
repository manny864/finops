-- Migración para soporte de purga y retención de almacenamiento de reportes y estado de cron jobs
ALTER TABLE ExecutiveReportJobs ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS SaaSCronJobs (
    job_key VARCHAR(100) PRIMARY KEY,
    job_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'HEALTHY',
    last_run_at DATETIME NULL,
    last_summary TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
