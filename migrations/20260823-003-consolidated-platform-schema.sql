-- ================================================================================
-- CONSOLIDATED DDL SCHEMA MIGRATION & SEED CATALOGS (MySQL 8.0 / InnoDB / utf8mb4)
-- CSCloudSolutions FinOps Platform - All 6 Core & Operational Domains
-- ================================================================================

-- --------------------------------------------------------------------------------
-- 1. DOMINIO "CORE Y TENANTS"
-- --------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS Tenants (
    tenant_id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    company_name VARCHAR(255) NULL,
    organization_name VARCHAR(255) NULL,
    entra_tenant_id VARCHAR(100) NULL,
    tier VARCHAR(50) NOT NULL DEFAULT 'Professional',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tenants_entra (entra_tenant_id),
    INDEX idx_tenants_tier (tier),
    INDEX idx_tenants_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS TenantSubscriptions (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    plan_tier ENUM('Professional','Business','Enterprise') NOT NULL DEFAULT 'Professional',
    max_allowed_subscriptions INT NOT NULL DEFAULT 2,
    status ENUM('ACTIVE','TRIAL','PAST_DUE','CANCELED') NOT NULL DEFAULT 'ACTIVE',
    paddle_subscription_id VARCHAR(100) NULL,
    paddle_price_id VARCHAR(100) NULL,
    is_manual_bypass BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tenant_subscription (tenant_id),
    INDEX idx_tenantsub_tier_status (plan_tier, status),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS TenantCommercialDeals (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    sales_rep_name VARCHAR(255) NULL,
    sales_commission_percent DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tenant_deal (tenant_id),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS TenantGlobalSettings (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    theme_preference ENUM('LIGHT','DARK','SYSTEM') NOT NULL DEFAULT 'SYSTEM',
    custom_logo_blob_url TEXT NULL,
    organization_display_name VARCHAR(255) NULL,
    is_master_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tenant_global_settings (tenant_id),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------------
-- 2. DOMINIO "CONFIGURACIÓN E INTEGRACIONES"
-- --------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS TenantIntegrations (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    proactive_alerts_webhook_url TEXT NULL,
    itsm_system ENUM('JIRA','AZURE_DEVOPS','SERVICENOW','NONE') NOT NULL DEFAULT 'NONE',
    itsm_base_url VARCHAR(500) NULL,
    itsm_api_key_encrypted TEXT NULL,
    itsm_project_key VARCHAR(100) NULL,
    power_bi_export_api_key VARCHAR(255) NULL,
    power_bi_export_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tenant_integrations (tenant_id),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS TenantAiSettings (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    is_ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    llm_provider ENUM('AZURE_OPENAI','OPENAI_DIRECT','ANTHROPIC_CLAUDE','GOOGLE_VERTEX') NOT NULL DEFAULT 'AZURE_OPENAI',
    encrypted_api_key TEXT NULL,
    api_key_masked_hint VARCHAR(50) NULL,
    azure_endpoint_url VARCHAR(500) NULL,
    deployment_model_name VARCHAR(100) NULL,
    anomaly_sensitivity ENUM('LOW','MEDIUM','HIGH','STRICT') NOT NULL DEFAULT 'MEDIUM',
    share_resource_names BOOLEAN NOT NULL DEFAULT FALSE,
    share_tags BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tenant_ai_settings (tenant_id),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS NotificationChannels (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    channel_type ENUM('SLACK','TEAMS','EMAIL','WEBHOOK') NOT NULL,
    target_config_json JSON NOT NULL,
    severity_filter ENUM('ALL','MEDIUM_AND_ABOVE','HIGH_AND_ABOVE','CRITICAL_ONLY') NOT NULL DEFAULT 'ALL',
    event_categories_json JSON NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_notif_channels_tenant (tenant_id, is_enabled),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS TenantM365CopilotSettings (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    connection_id VARCHAR(100) NULL,
    connector_status VARCHAR(50) NOT NULL DEFAULT 'DISCONNECTED',
    agent_status VARCHAR(50) NOT NULL DEFAULT 'INACTIVE',
    total_indexed_records_count INT NOT NULL DEFAULT 0,
    last_indexed_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tenant_m365 (tenant_id),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS TenantMcpApiKeys (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    key_prefix VARCHAR(20) NOT NULL,
    key_hash VARCHAR(128) NOT NULL,
    last_used_at DATETIME NULL,
    expires_at DATETIME NULL,
    revoked_at DATETIME NULL,
    created_by_email VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_mcp_tenant_hash (tenant_id, key_hash),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS TenantPublicApiKeys (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    key_prefix VARCHAR(20) NOT NULL,
    key_hash VARCHAR(128) NOT NULL,
    rate_limit_per_minute INT NOT NULL DEFAULT 60,
    scopes_json JSON NULL,
    last_used_at DATETIME NULL,
    revoked_at DATETIME NULL,
    created_by_email VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_public_api_tenant (tenant_id, key_hash),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------------
-- 3. DOMINIO "REPORTES Y FACTURACIÓN"
-- --------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ExecutiveReportJobs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    requested_by_email VARCHAR(255) NOT NULL,
    scope_subscription_id VARCHAR(100) NOT NULL DEFAULT 'All',
    scope_subscription_name VARCHAR(255) NOT NULL DEFAULT 'Tenant completo',
    locale VARCHAR(10) NOT NULL DEFAULT 'es',
    status ENUM('queued','processing','completed','failed','QUEUED','COLLECTING_METRICS','AI_SYNTHESIZING','COMPILING_PDF','COMPLETED','FAILED') NOT NULL DEFAULT 'queued',
    progress_percent INT NOT NULL DEFAULT 0,
    current_step_label VARCHAR(255) NULL,
    report_id VARCHAR(100) NULL,
    report_markdown MEDIUMTEXT NULL,
    report_stored_name VARCHAR(500) NULL,
    total_cost_usd DECIMAL(18,4) NULL,
    total_savings_usd DECIMAL(18,4) NULL,
    error_message TEXT NULL,
    started_at DATETIME NULL,
    completed_at DATETIME NULL,
    emailed_to_requester_at DATETIME NULL,
    deleted_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_exec_jobs_tenant_created (tenant_id, created_at),
    INDEX idx_exec_jobs_lookup (tenant_id, requested_by_email, scope_subscription_id, id),
    INDEX idx_exec_jobs_retention (tenant_id, created_at, deleted_at),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ExecutiveReportHistory (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    report_name VARCHAR(255) NOT NULL,
    scope_type ENUM('TENANT_ALL','SUBSCRIPTION','RESOURCE_GROUP') NOT NULL DEFAULT 'TENANT_ALL',
    scope_id VARCHAR(100) NULL,
    requested_by_email VARCHAR(255) NOT NULL,
    sent_by_email BOOLEAN NOT NULL DEFAULT FALSE,
    pdf_blob_name VARCHAR(500) NOT NULL,
    json_snapshot_blob_name VARCHAR(500) NOT NULL,
    blob_size_bytes BIGINT NOT NULL DEFAULT 0,
    total_monthly_cost_snapshot_usd DECIMAL(18,4) NULL,
    total_monthly_savings_snapshot_usd DECIMAL(18,4) NULL,
    tier_retention_days INT NOT NULL DEFAULT 90,
    expires_at DATETIME NULL,
    deleted_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_exec_hist_tenant_created (tenant_id, created_at),
    INDEX idx_exec_hist_expires (expires_at, deleted_at),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS TenantMarkupSettings (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    global_markup_percentage DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    fixed_management_fee_usd DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    is_markup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tenant_markup (tenant_id),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS MarkupOverrideRules (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    rule_name VARCHAR(255) NOT NULL,
    scope_type ENUM('SUBSCRIPTION','SERVICE_CATEGORY') NOT NULL,
    scope_value VARCHAR(255) NOT NULL,
    override_percentage DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_markup_rules_tenant (tenant_id, is_enabled),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS TenantFocusSchedule (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    spec_version ENUM('1.0','1.1') NOT NULL DEFAULT '1.0',
    file_format ENUM('CSV','PARQUET','JSONL') NOT NULL DEFAULT 'CSV',
    delivery_method ENUM('EMAIL','AZURE_BLOB_STORAGE') NOT NULL DEFAULT 'EMAIL',
    recipient_email VARCHAR(255) NULL,
    azure_blob_container_url TEXT NULL,
    azure_blob_sas_encrypted TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tenant_focus_schedule (tenant_id),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------------
-- 4. DOMINIO "OPERACIONES, SUPERADMIN Y AUDITORÍA"
-- --------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS Notifications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'SYSTEM_ALERT',
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    action_url VARCHAR(500) NULL,
    href VARCHAR(500) NULL,
    severity VARCHAR(50) NOT NULL DEFAULT 'info',
    source VARCHAR(100) NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_notif_tenant_created (tenant_id, created_at),
    INDEX idx_notif_tenant_unread (tenant_id, is_read),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS TenantNotifications (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'SYSTEM_ALERT',
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    action_url VARCHAR(500) NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tnotif_tenant_created (tenant_id, created_at),
    INDEX idx_tnotif_tenant_unread (tenant_id, is_read),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS AuditTrailLogs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    user_name VARCHAR(255) NULL,
    ip_address VARCHAR(100) NULL,
    user_agent VARCHAR(500) NULL,
    action_type VARCHAR(100) NOT NULL,
    resource_target_id VARCHAR(500) NULL,
    resource_target_name VARCHAR(255) NULL,
    status ENUM('SUCCESS','FAILED','PENDING') NOT NULL DEFAULT 'SUCCESS',
    metadata_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_audit_tenant_created (tenant_id, created_at),
    INDEX idx_audit_action (action_type),
    INDEX idx_audit_user (user_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS SaaSCronJobs (
    id VARCHAR(36) PRIMARY KEY,
    job_key VARCHAR(100) NOT NULL UNIQUE,
    job_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'HEALTHY',
    schedule_cron_expression VARCHAR(100) NULL,
    last_run_at DATETIME NULL,
    duration_ms INT NOT NULL DEFAULT 0,
    last_summary_text TEXT NULL,
    last_error_message TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_cron_jobs_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS SaaSComponentHealth (
    id VARCHAR(36) PRIMARY KEY,
    component_key VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    status ENUM('HEALTHY','DEGRADED','DOWN') NOT NULL DEFAULT 'HEALTHY',
    latency_ms INT NOT NULL DEFAULT 0,
    uptime_30d_percent DECIMAL(5,2) NOT NULL DEFAULT 100.00,
    last_checked_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS TenantPartnerCenterAssociations (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    association_type ENUM('PAL','CPOR') NOT NULL DEFAULT 'PAL',
    partner_mpn_id VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    error_details_text TEXT NULL,
    last_checked_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_partner_assoc (tenant_id, association_type),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS BillingPricingUnitsCatalog (
    id VARCHAR(36) PRIMARY KEY,
    raw_uom_name VARCHAR(100) NOT NULL UNIQUE,
    block_size_multiplier DECIMAL(18,6) NOT NULL DEFAULT 1.0,
    base_unit_key VARCHAR(50) NOT NULL,
    display_unit_name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_pricing_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS PricingUnits (
    uom_raw VARCHAR(100) NOT NULL PRIMARY KEY,
    block_size DECIMAL(18,6) NOT NULL DEFAULT 1.0,
    base_unit VARCHAR(50) NOT NULL,
    display_unit VARCHAR(100),
    category VARCHAR(50),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_pricingunits_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS SaaSLoadTestHistory (
    id VARCHAR(36) PRIMARY KEY,
    target_endpoint VARCHAR(500) NOT NULL,
    concurrency_level INT NOT NULL DEFAULT 10,
    duration_seconds INT NOT NULL DEFAULT 30,
    total_requests_sent INT NOT NULL DEFAULT 0,
    total_errors_count INT NOT NULL DEFAULT 0,
    p95_latency_ms DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    throughput_req_per_sec DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    executed_by_email VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_load_test_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS PlatformGlobalAiConfig (
    id VARCHAR(36) PRIMARY KEY,
    is_platform_master_ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    non_enterprise_provider VARCHAR(50) NOT NULL DEFAULT 'AZURE_OPENAI',
    non_enterprise_encrypted_api_key TEXT NULL,
    non_enterprise_deployment_model VARCHAR(100) NOT NULL DEFAULT 'gpt-4o-mini',
    enterprise_provider VARCHAR(50) NOT NULL DEFAULT 'AZURE_OPENAI',
    enterprise_encrypted_api_key TEXT NULL,
    enterprise_deployment_model VARCHAR(100) NOT NULL DEFAULT 'gpt-4o',
    default_anomaly_sensitivity ENUM('LOW','MEDIUM','HIGH','STRICT') NOT NULL DEFAULT 'MEDIUM',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------------------------------
-- 5. INITIAL SEED DATA & CATALOGS
-- --------------------------------------------------------------------------------

-- Seed: SaaSCronJobs (9 Scheduled Jobs)
INSERT INTO SaaSCronJobs (id, job_key, job_name, status, schedule_cron_expression, last_summary_text) VALUES
('cron-001', 'anomaly-detection', 'Detección de Anomalías 3-Sigma', 'HEALTHY', '0 */2 * * *', 'Escaneo de anomalías 3-Sigma en background.'),
('cron-002', 'cost-sync-staleness-check', 'Chequeo de Frescura de Costos', 'HEALTHY', '0 8 * * *', 'Verificación de staleness de ingesta diaria.'),
('cron-003', 'credential-expiry-alerts', 'Auditoría de Expiración de Credenciales', 'HEALTHY', '0 7 * * *', 'Barrido de secretos y certificados de Service Principals.'),
('cron-004', 'focus-export-daily', 'Exportación Diaria FOCUS 1.0', 'HEALTHY', '0 3 * * *', 'Generación de datasets normalizados FOCUS 1.0.'),
('cron-005', 'historical-gap-backfill', 'Backfill de Huecos Históricos', 'HEALTHY', '0 1 * * 0', 'Relleno de ventanas de facturación sin datos.'),
('cron-006', 'open-data', 'Catálogo de Precios Open Data', 'HEALTHY', '0 8 * * *', 'Sincronización con Microsoft Retail API y FinOps Toolkit.'),
('cron-007', 'partner-link-retry', 'Reintentos de Enlace de Partner (MPN)', 'HEALTHY', '0 6 * * *', 'Vinculación PAL / CPOR hacia Microsoft Partner Center.'),
('cron-008', 'power-schedules', 'Políticas de Power Schedules (VMs)', 'HEALTHY', '*/10 * * * *', 'Encendido y apagado automatizado de VMs.'),
('cron-009', 'storage-retention-cleanup', 'Purga Automática de Reportes por Tier', 'HEALTHY', '0 4 * * *', 'Eliminación de blobs de reportes > 90/180/365 días.')
ON DUPLICATE KEY UPDATE job_name = VALUES(job_name);

-- Seed: SaaSComponentHealth (6 Core Components)
INSERT INTO SaaSComponentHealth (id, component_key, display_name, status, latency_ms, uptime_30d_percent) VALUES
('comp-001', 'database-mysql', 'Base de Datos MySQL (Azure Flexible Server)', 'HEALTHY', 12, 99.99),
('comp-002', 'redis-cache', 'Caché en Memoria y Lock Manager (Redis)', 'HEALTHY', 2, 100.00),
('comp-003', 'azure-arm-api', 'Azure Resource Graph & ARM Gateway', 'HEALTHY', 45, 99.95),
('comp-004', 'azure-openai-gateway', 'Azure OpenAI Service (SaaS Gateway)', 'HEALTHY', 110, 99.90),
('comp-005', 'blob-storage', 'Azure Blob Storage (Reportes y Adjuntos)', 'HEALTHY', 18, 99.99),
('comp-006', 'email-smtp-service', 'Servicio de Notificaciones y SMTP', 'HEALTHY', 25, 100.00)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

-- Seed: PlatformGlobalAiConfig (Single Master Record)
INSERT INTO PlatformGlobalAiConfig (
    id, is_platform_master_ai_enabled, non_enterprise_provider, non_enterprise_deployment_model,
    enterprise_provider, enterprise_deployment_model, default_anomaly_sensitivity
) VALUES (
    'global-ai-config-001', TRUE, 'AZURE_OPENAI', 'gpt-4o-mini', 'AZURE_OPENAI', 'gpt-4o', 'MEDIUM'
) ON DUPLICATE KEY UPDATE is_platform_master_ai_enabled = VALUES(is_platform_master_ai_enabled);

-- Seed: BillingPricingUnitsCatalog & PricingUnits (Official FinOps Toolkit 45 Units)
INSERT INTO BillingPricingUnitsCatalog (id, raw_uom_name, block_size_multiplier, base_unit_key, display_unit_name, category) VALUES
('uom-01', '1 Hour', 1.0, 'Hour', 'Hours', 'COMPUTE'),
('uom-02', '100 Hours', 100.0, 'Hour', 'Hours', 'COMPUTE'),
('uom-03', '1000 Hours', 1000.0, 'Hour', 'Hours', 'COMPUTE'),
('uom-04', '10 Hours', 10.0, 'Hour', 'Hours', 'COMPUTE'),
('uom-05', '1 Day', 24.0, 'Hour', 'Days', 'COMPUTE'),
('uom-06', '1 Month', 730.0, 'Hour', 'Months', 'COMPUTE'),
('uom-07', '1 Second', 0.000277778, 'Hour', 'Seconds', 'COMPUTE'),
('uom-08', '1 Minute', 0.0166667, 'Hour', 'Minutes', 'COMPUTE'),
('uom-09', '1/Hour', 1.0, 'Hour', '/Hour', 'COMPUTE'),
('uom-10', '100 Hours/Month', 100.0, 'Hour', 'Hours/Month', 'COMPUTE'),
('uom-11', '1 vCPU/Hour', 1.0, 'vCPUHour', 'vCPU/Hour', 'COMPUTE'),
('uom-12', '1 Core/Hour', 1.0, 'vCPUHour', 'Core/Hour', 'COMPUTE'),
('uom-13', '1 GB', 1.0, 'GB', 'GB', 'STORAGE'),
('uom-14', '1 GB/Month', 1.0, 'GB', 'GB/Month', 'STORAGE'),
('uom-15', '1 GB/Hour', 1.0, 'GB', 'GB/Hour', 'STORAGE'),
('uom-16', '10 GB', 10.0, 'GB', 'GB', 'STORAGE'),
('uom-17', '100 GB', 100.0, 'GB', 'GB', 'STORAGE'),
('uom-18', '1000 GB', 1000.0, 'GB', 'GB', 'STORAGE'),
('uom-19', '1 TB', 1000.0, 'GB', 'TB', 'STORAGE'),
('uom-20', '1 TB/Month', 1000.0, 'GB', 'TB/Month', 'STORAGE'),
('uom-21', '1 MB', 0.001, 'GB', 'MB', 'STORAGE'),
('uom-22', '1 PB', 1000000.0, 'GB', 'PB', 'STORAGE'),
('uom-23', '1 Token', 1.0, 'Token', 'Tokens', 'AI'),
('uom-24', '1K Tokens', 1000.0, 'Token', 'Tokens', 'AI'),
('uom-25', '1M Tokens', 1000000.0, 'Token', 'Tokens', 'AI'),
('uom-26', '1000000 Tokens', 1000000.0, 'Token', 'Tokens', 'AI'),
('uom-27', '1 Image', 1.0, 'Image', 'Images', 'AI'),
('uom-28', '100 Images', 100.0, 'Image', 'Images', 'AI'),
('uom-29', '1 GB Data Transfer', 1.0, 'GB', 'GB Transferred', 'NETWORK'),
('uom-30', '10 GB Data Transfer', 10.0, 'GB', 'GB Transferred', 'NETWORK'),
('uom-31', '100 GB Data Transfer', 100.0, 'GB', 'GB Transferred', 'NETWORK'),
('uom-32', '1 TB Data Transfer', 1000.0, 'GB', 'TB Transferred', 'NETWORK'),
('uom-33', '1 Transaction', 1.0, 'Transaction', 'Transactions', 'OTHER'),
('uom-34', '10K Transactions', 10000.0, 'Transaction', 'Transactions', 'OTHER'),
('uom-35', '100K Transactions', 100000.0, 'Transaction', 'Transactions', 'OTHER'),
('uom-36', '1M Transactions', 1000000.0, 'Transaction', 'Transactions', 'OTHER'),
('uom-37', '10M Transactions', 10000000.0, 'Transaction', 'Transactions', 'OTHER'),
('uom-38', '1 Operation', 1.0, 'Transaction', 'Operations', 'OTHER'),
('uom-39', '10K Operations', 10000.0, 'Transaction', 'Operations', 'OTHER'),
('uom-40', '1M Operations', 1000000.0, 'Transaction', 'Operations', 'OTHER'),
('uom-41', '1 Request', 1.0, 'Transaction', 'Requests', 'OTHER'),
('uom-42', '10K Requests', 10000.0, 'Transaction', 'Requests', 'OTHER'),
('uom-43', '1M Requests', 1000000.0, 'Transaction', 'Requests', 'OTHER'),
('uom-44', '1 Million Requests', 1000000.0, 'Transaction', 'Requests', 'OTHER'),
('uom-45', '1 Unit', 1.0, 'Unit', 'Units', 'OTHER')
ON DUPLICATE KEY UPDATE display_unit_name = VALUES(display_unit_name);

INSERT INTO PricingUnits (uom_raw, block_size, base_unit, display_unit, category) VALUES
('1 Hour', 1.0, 'Hour', 'Hours', 'COMPUTE'),
('100 Hours', 100.0, 'Hour', 'Hours', 'COMPUTE'),
('1000 Hours', 1000.0, 'Hour', 'Hours', 'COMPUTE'),
('10 Hours', 10.0, 'Hour', 'Hours', 'COMPUTE'),
('1 Day', 24.0, 'Hour', 'Days', 'COMPUTE'),
('1 Month', 730.0, 'Hour', 'Months', 'COMPUTE'),
('1 Second', 0.000277778, 'Hour', 'Seconds', 'COMPUTE'),
('1 Minute', 0.0166667, 'Hour', 'Minutes', 'COMPUTE'),
('1/Hour', 1.0, 'Hour', '/Hour', 'COMPUTE'),
('100 Hours/Month', 100.0, 'Hour', 'Hours/Month', 'COMPUTE'),
('1 vCPU/Hour', 1.0, 'vCPUHour', 'vCPU/Hour', 'COMPUTE'),
('1 Core/Hour', 1.0, 'vCPUHour', 'Core/Hour', 'COMPUTE'),
('1 GB', 1.0, 'GB', 'GB', 'STORAGE'),
('1 GB/Month', 1.0, 'GB', 'GB/Month', 'STORAGE'),
('1 GB/Hour', 1.0, 'GB', 'GB/Hour', 'STORAGE'),
('10 GB', 10.0, 'GB', 'GB', 'STORAGE'),
('100 GB', 100.0, 'GB', 'GB', 'STORAGE'),
('1000 GB', 1000.0, 'GB', 'GB', 'STORAGE'),
('1 TB', 1000.0, 'GB', 'TB', 'STORAGE'),
('1 TB/Month', 1000.0, 'GB', 'TB/Month', 'STORAGE'),
('1 MB', 0.001, 'GB', 'MB', 'STORAGE'),
('1 PB', 1000000.0, 'GB', 'PB', 'STORAGE'),
('1 Token', 1.0, 'Token', 'Tokens', 'AI'),
('1K Tokens', 1000.0, 'Token', 'Tokens', 'AI'),
('1M Tokens', 1000000.0, 'Token', 'Tokens', 'AI'),
('1000000 Tokens', 1000000.0, 'Token', 'Tokens', 'AI'),
('1 Image', 1.0, 'Image', 'Images', 'AI'),
('100 Images', 100.0, 'Image', 'Images', 'AI'),
('1 GB Data Transfer', 1.0, 'GB', 'GB Transferred', 'NETWORK'),
('10 GB Data Transfer', 10.0, 'GB', 'GB Transferred', 'NETWORK'),
('100 GB Data Transfer', 100.0, 'GB', 'GB Transferred', 'NETWORK'),
('1 TB Data Transfer', 1000.0, 'GB', 'TB Transferred', 'NETWORK'),
('1 Transaction', 1.0, 'Transaction', 'Transactions', 'OTHER'),
('10K Transactions', 10000.0, 'Transaction', 'Transactions', 'OTHER'),
('100K Transactions', 100000.0, 'Transaction', 'Transactions', 'OTHER'),
('1M Transactions', 1000000.0, 'Transaction', 'Transactions', 'OTHER'),
('10M Transactions', 10000000.0, 'Transaction', 'Transactions', 'OTHER'),
('1 Operation', 1.0, 'Transaction', 'Operations', 'OTHER'),
('10K Operations', 10000.0, 'Transaction', 'Operations', 'OTHER'),
('1M Operations', 1000000.0, 'Transaction', 'Operations', 'OTHER'),
('1 Request', 1.0, 'Transaction', 'Requests', 'OTHER'),
('10K Requests', 10000.0, 'Transaction', 'Requests', 'OTHER'),
('1M Requests', 1000000.0, 'Transaction', 'Requests', 'OTHER'),
('1 Million Requests', 1000000.0, 'Transaction', 'Requests', 'OTHER'),
('1 Unit', 1.0, 'Unit', 'Units', 'OTHER')
ON DUPLICATE KEY UPDATE display_unit = VALUES(display_unit);
