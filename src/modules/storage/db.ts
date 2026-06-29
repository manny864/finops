import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const globalForPool = globalThis as unknown as {
    __finopsMysqlPool?: mysql.Pool;
};

function createPool(): mysql.Pool {
    return mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'finops_user',
        password: process.env.DB_PASSWORD || 'finopspassword',
        database: process.env.DB_NAME || 'finops_app',
        port: Number(process.env.DB_PORT || 3306),
        connectionLimit: Number(process.env.DB_POOL_LIMIT || 10),
        waitForConnections: true,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
    });
}

const pool: mysql.Pool = globalForPool.__finopsMysqlPool ?? createPool();
if (process.env.NODE_ENV !== 'production') {
    globalForPool.__finopsMysqlPool = pool;
}

let dbInitialized = false;

export async function initializeDatabase() {
    if (dbInitialized) return;
    try {
        const connection = await pool.getConnection();
        
        await connection.query(`
            CREATE TABLE IF NOT EXISTS Tenants (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) UNIQUE NOT NULL,
                company_name VARCHAR(255),
                client_id VARCHAR(255),
                client_secret VARCHAR(255),
                status VARCHAR(50) DEFAULT 'active',
                webhook_url VARCHAR(1024),
                tier ENUM('Essential', 'Professional', 'Business', 'Enterprise') DEFAULT 'Essential',
                trial_ends_at DATETIME NULL,
                subscription_status ENUM('TRIAL', 'ACTIVE', 'EXPIRED') DEFAULT 'ACTIVE',
                is_onboarded BOOLEAN DEFAULT FALSE,
                ai_provider VARCHAR(50) DEFAULT 'system',
                ai_api_key VARCHAR(255),
                paddle_subscription_id VARCHAR(255),
                last_sync_at TIMESTAMP NULL,
                sync_status VARCHAR(50) DEFAULT 'OK',
                last_error_message TEXT,
                markup_percentage DECIMAL(5,2) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Check if webhook_url exists for backward compatibility or modify it
        try {
            await connection.query('ALTER TABLE Tenants ADD COLUMN webhook_url VARCHAR(1024);');
        } catch (e: any) {
            // Ignore Duplicate column error, but modify if it already exists to ensure it's VARCHAR(1024)
            if (e.code === 'ER_DUP_FIELDNAME') {
                try {
                    await connection.query('ALTER TABLE Tenants MODIFY COLUMN webhook_url VARCHAR(1024);');
                } catch (modifyError) {
                    console.error("Error modifying webhook_url to VARCHAR(1024):", modifyError);
                }
            } else {
                console.error("Error adding webhook_url:", e);
            }
        }

        // Add last_sync_at, sync_status, and last_error_message if they don't exist
        try {
            await connection.query('ALTER TABLE Tenants ADD COLUMN last_sync_at TIMESTAMP NULL;');
        } catch (e: any) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error("Error adding last_sync_at:", e);
        }



        // Add client_id and client_secret if they don't exist
        try {
            await connection.query('ALTER TABLE Tenants ADD COLUMN client_id VARCHAR(255);');
        } catch (e: any) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error("Error adding client_id:", e);
        }

        try {
            await connection.query('ALTER TABLE Tenants ADD COLUMN client_secret VARCHAR(255);');
        } catch (e: any) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error("Error adding client_secret:", e);
        }

        // Add recent columns
        try {
            await connection.query('ALTER TABLE Tenants ADD COLUMN is_onboarded BOOLEAN DEFAULT FALSE;');
        } catch (e: any) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error("Error adding is_onboarded:", e);
        }
        
        try {
            await connection.query("ALTER TABLE Tenants ADD COLUMN ai_provider VARCHAR(50) DEFAULT 'system';");
        } catch (e: any) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error("Error adding ai_provider:", e);
        }

        try {
            await connection.query('ALTER TABLE Tenants ADD COLUMN ai_api_key VARCHAR(255);');
        } catch (e: any) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error("Error adding ai_api_key:", e);
        }

        try {
            await connection.query('ALTER TABLE Tenants ADD COLUMN paddle_subscription_id VARCHAR(255);');
        } catch (e: any) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error("Error adding paddle_subscription_id:", e);
        }

        await connection.query(`
            CREATE TABLE IF NOT EXISTS Users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                entra_oid VARCHAR(255) NOT NULL,
                tenant_id VARCHAR(255) NOT NULL,
                email VARCHAR(255),
                display_name VARCHAR(255),
                role VARCHAR(50) DEFAULT 'Admin',
                system_role VARCHAR(50) DEFAULT 'USER',
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
                UNIQUE KEY unique_user_tenant (entra_oid, tenant_id)
            )
        `);

        // Safe migrations for Users table
        try {
            await connection.query('ALTER TABLE Users ADD COLUMN display_name VARCHAR(255);');
        } catch (e: any) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error("Error adding display_name:", e);
        }

        try {
            await connection.query("ALTER TABLE Users ADD COLUMN system_role VARCHAR(50) DEFAULT 'USER';");
        } catch (e: any) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error("Error adding system_role:", e);
        }

        try {
            await connection.query('ALTER TABLE Users DROP INDEX entra_oid;');
        } catch (e: any) {
            // Ignore if index doesn't exist (e.g. ER_CANT_DROP_FIELD_OR_KEY)
        }

        try {
            await connection.query('ALTER TABLE Users ADD UNIQUE KEY unique_user_tenant (entra_oid, tenant_id);');
        } catch (e: any) {
            if (e.code !== 'ER_DUP_KEYNAME') console.error("Error adding unique_user_tenant:", e);
        }

        try {
            await connection.query('ALTER TABLE Users ADD COLUMN scope JSON;');
        } catch (e: any) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error("Error adding scope:", e);
        }

        await connection.query(`
            CREATE TABLE IF NOT EXISTS TaggingPolicies (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                tag_key VARCHAR(255) NOT NULL,
                required BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS CostCenterBudgets (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                cost_center_name VARCHAR(255) NOT NULL,
                monthly_budget_usd DECIMAL(10,2) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_tenant_costcenter (tenant_id, cost_center_name),
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS SavingsHistory (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                scan_date DATE NOT NULL,
                total_wasted_usd DECIMAL(10,2) NOT NULL,
                potential_savings_usd DECIMAL(10,2) NOT NULL,
                UNIQUE KEY unique_scan (tenant_id, scan_date),
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS ActionLogs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                user_email VARCHAR(255) NOT NULL,
                action_type VARCHAR(50) NOT NULL,
                resource_id VARCHAR(255) NOT NULL,
                status VARCHAR(20) NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS GlobalSettings (
                setting_key VARCHAR(50) PRIMARY KEY,
                setting_value TEXT NOT NULL
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS AiCache (
                hash_prompt VARCHAR(64) PRIMARY KEY,
                response_text TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS CostSnapshots (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(100) NOT NULL,
                subscription_id VARCHAR(100) DEFAULT 'default',
                date DATE NOT NULL,
                resource_group VARCHAR(100) NOT NULL,
                service_name VARCHAR(100) NOT NULL,
                cost_usd DECIMAL(12, 4) NOT NULL,
                currency VARCHAR(10) DEFAULT 'USD',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
                UNIQUE KEY unique_tenant_date_rg_service_sub (tenant_id, subscription_id, date, resource_group, service_name)
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS RecommendationsCache (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                recommendation_type VARCHAR(255) NOT NULL,
                potential_savings DECIMAL(12, 4) NOT NULL,
                snapshot_date DATE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
                UNIQUE KEY unique_tenant_rec_type_date (tenant_id, recommendation_type, snapshot_date)
            )
        `);

        // FOCUS Standard Schema Migration for CostSnapshots
        const focusColumns = [
            "ADD COLUMN ChargePeriodStart DATETIME",
            "ADD COLUMN ChargePeriodEnd DATETIME",
            "ADD COLUMN ProviderName VARCHAR(100) DEFAULT 'Azure'",
            "ADD COLUMN PublisherName VARCHAR(100)",
            "ADD COLUMN SubAccountId VARCHAR(100)",
            "ADD COLUMN BilledCost DECIMAL(12,4)",
            "ADD COLUMN EffectiveCost DECIMAL(12,4)",
            "ADD COLUMN CommitmentDiscountId VARCHAR(255)",
            "ADD COLUMN MeterId VARCHAR(255)",
            "ADD COLUMN MeterName VARCHAR(255)",
            "ADD COLUMN MeterCategory VARCHAR(255)",
            "ADD COLUMN MeterSubCategory VARCHAR(255)",
            "ADD COLUMN Quantity DECIMAL(18,6)",
            "ADD COLUMN UnitOfMeasure VARCHAR(64)",
            "ADD COLUMN ResourceId VARCHAR(500)",
            "ADD COLUMN ServiceFamily VARCHAR(100)",
            "ADD COLUMN Tags JSON"
        ];
        
        for (const col of focusColumns) {
            try {
                await connection.query(`ALTER TABLE CostSnapshots ${col};`);
            } catch (e: any) {
                if (e.code !== 'ER_DUP_FIELDNAME') console.error(`Error adding FOCUS column ${col}:`, e);
            }
        }

        await connection.query(`
            CREATE TABLE IF NOT EXISTS cost_snapshots (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255),
                sync_date DATE,
                total_cost_usd DECIMAL(10,2),
                currency VARCHAR(10),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_tenant_sync_date (tenant_id, sync_date)
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS tenant_health (
                tenant_id VARCHAR(255) PRIMARY KEY,
                last_sync_at TIMESTAMP,
                sync_status VARCHAR(50),
                last_error TEXT
            )
        `);

        
        await connection.query(`
            CREATE TABLE IF NOT EXISTS TenantMonthlyBudgets (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                budget_month TINYINT NOT NULL,
                budget_year SMALLINT NOT NULL,
                budget_usd DECIMAL(12,2) NOT NULL,
                alert_threshold DECIMAL(5,2) DEFAULT 80.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
                UNIQUE KEY unique_tenant_month_year (tenant_id, budget_month, budget_year)
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS RemediationRequests (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                resource_id VARCHAR(1024) NOT NULL,
                resource_name VARCHAR(255) NOT NULL,
                action_type VARCHAR(100) NOT NULL,
                estimated_savings DECIMAL(12,2) DEFAULT 0.00,
                status ENUM('Pending', 'Approved', 'Rejected') DEFAULT 'Pending',
                requested_by VARCHAR(255) NOT NULL,
                requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                resolved_at TIMESTAMP NULL,
                resolved_by VARCHAR(255) NULL,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
            )
        `);

        // Create AllocationRules table for Shared Cost Distribution (Enterprise Module)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS AllocationRules (
                id VARCHAR(36) PRIMARY KEY,
                tenantId VARCHAR(36) NOT NULL,
                resourceName VARCHAR(255) NOT NULL,
                targetCostCenter VARCHAR(255) NOT NULL,
                allocationPercentage DECIMAL(5, 2) NOT NULL,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_tenant (tenantId)
            )
        `);

        // Create Anomalies table for Z-Score ML Engine (Pro Module)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS Anomalies (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                subscription_id VARCHAR(255) NOT NULL,
                date DATE NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                expected_amount DECIMAL(12,2) NOT NULL,
                z_score DECIMAL(5,2) NOT NULL,
                status ENUM('New', 'Investigating', 'Resolved', 'False Positive') DEFAULT 'New',
                detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
            )
        `);

        // Create AcademyProgress table for FinOps Academy (Starter Module)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS AcademyProgress (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                tenant_id VARCHAR(255) NOT NULL,
                module_id VARCHAR(100) NOT NULL,
                completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
                UNIQUE KEY unique_user_module (user_id, module_id)
            )
        `);

        // Maturity Assessments for FinOps Crawl/Walk/Run
        await connection.query(`
            CREATE TABLE IF NOT EXISTS MaturityAssessments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                score INT NOT NULL,
                level ENUM('Crawl', 'Walk', 'Run') NOT NULL,
                assessment_data JSON NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
            )
        `);

        // ===== IT-13: Pipeline Health (ingestion lag tracking) =====
        try {
            await connection.query('ALTER TABLE CostSnapshots ADD COLUMN ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
        } catch (e: any) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error('Error adding ingested_at:', e);
        }

        await connection.query(`
            CREATE TABLE IF NOT EXISTS DataPipelineEvents (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                source VARCHAR(50) NOT NULL,
                period_end DATETIME NOT NULL,
                ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                record_count INT DEFAULT 0,
                status VARCHAR(30) DEFAULT 'ok',
                error_msg TEXT,
                INDEX idx_tenant_source_ingested (tenant_id, source, ingested_at)
            )
        `);

        // ===== IT-08: Open Data sets (Microsoft FinOps Toolkit) =====
        await connection.query(`
            CREATE TABLE IF NOT EXISTS OpenDataServices (
                consumed_service VARCHAR(255) NOT NULL,
                resource_type VARCHAR(255) NOT NULL,
                service_name VARCHAR(255),
                service_category VARCHAR(100),
                service_model VARCHAR(100),
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (consumed_service, resource_type)
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS OpenDataRegions (
                resource_location VARCHAR(120) PRIMARY KEY,
                region_id VARCHAR(120),
                region_name VARCHAR(200),
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS OpenDataResourceTypes (
                resource_type VARCHAR(255) PRIMARY KEY,
                singular_display_name VARCHAR(255),
                plural_display_name VARCHAR(255),
                icon VARCHAR(255),
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS OpenDataPricingUnits (
                unit_of_measure VARCHAR(120) PRIMARY KEY,
                distinct_units DECIMAL(18,6),
                pricing_block_size DECIMAL(18,6),
                pricing_unit VARCHAR(120),
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS OpenDataCommitmentEligibility (
                meter_id VARCHAR(120) PRIMARY KEY,
                meter_name VARCHAR(255),
                service_family VARCHAR(100),
                product_name VARCHAR(255),
                sku_name VARCHAR(255),
                region VARCHAR(120),
                ri_eligible BOOLEAN DEFAULT FALSE,
                sp_eligible BOOLEAN DEFAULT FALSE,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_service_family (service_family),
                INDEX idx_sku (sku_name, region)
            )
        `);

        await connection.query(`
            CREATE TABLE IF NOT EXISTS OpenDataSyncState (
                dataset VARCHAR(60) PRIMARY KEY,
                last_sync_at TIMESTAMP NULL,
                last_status VARCHAR(20),
                row_count INT DEFAULT 0,
                source_url VARCHAR(500),
                error_msg TEXT
            )
        `);

        // ===== IT-05 + IT-06: Recommendation tracking + suppression =====
        await connection.query(`
            CREATE TABLE IF NOT EXISTS RecommendationActions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                recommendation_id VARCHAR(500) NOT NULL,
                category VARCHAR(50),
                resource_id VARCHAR(1024),
                status ENUM('open','accepted','implemented','dismissed','suppressed') DEFAULT 'open',
                user_email VARCHAR(255),
                reason TEXT,
                expires_at DATETIME NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
                UNIQUE KEY uniq_rec (tenant_id, recommendation_id),
                INDEX idx_tenant_status (tenant_id, status)
            )
        `);

        // ===== IT-01: Azure OpenAI Cost Analytics =====
        await connection.query(`
            CREATE TABLE IF NOT EXISTS AICostSnapshots (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                date DATE NOT NULL,
                subscription_id VARCHAR(100),
                resource_name VARCHAR(255),
                resource_group VARCHAR(255),
                application VARCHAR(120),
                team VARCHAR(120),
                environment VARCHAR(60),
                model_name VARCHAR(120),
                input_tokens BIGINT DEFAULT 0,
                output_tokens BIGINT DEFAULT 0,
                billed_cost DECIMAL(14,4) DEFAULT 0,
                effective_cost DECIMAL(14,4) DEFAULT 0,
                tags JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
                INDEX idx_ai_tenant_date (tenant_id, date),
                INDEX idx_ai_model (model_name)
            )
        `);

        // ===== IT-04: MACC Commitment Tracking =====
        await connection.query(`
            CREATE TABLE IF NOT EXISTS MACCCommitments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                billing_account_id VARCHAR(255) NOT NULL,
                billing_profile_id VARCHAR(255),
                commitment_amount DECIMAL(16,2) NOT NULL,
                consumed_amount DECIMAL(16,2) DEFAULT 0,
                remaining_amount DECIMAL(16,2) DEFAULT 0,
                burn_rate_monthly DECIMAL(16,2) DEFAULT 0,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                currency VARCHAR(10) DEFAULT 'USD',
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
                UNIQUE KEY uniq_macc (tenant_id, billing_account_id, start_date)
            )
        `);

        // ===== IT-03 / IT-07: Extended rightsizing tables =====
        await connection.query(`
            CREATE TABLE IF NOT EXISTS AppServiceRecommendations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                subscription_id VARCHAR(100),
                resource_group VARCHAR(255),
                plan_name VARCHAR(255) NOT NULL,
                current_sku VARCHAR(80),
                recommended_sku VARCHAR(80),
                avg_cpu_percent DECIMAL(5,2),
                avg_mem_percent DECIMAL(5,2),
                monthly_cost DECIMAL(12,2),
                estimated_savings DECIMAL(12,2),
                reason VARCHAR(255),
                detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
                INDEX idx_as_tenant (tenant_id)
            )
        `);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS SqlDbRecommendations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                subscription_id VARCHAR(100),
                server_name VARCHAR(255),
                db_name VARCHAR(255),
                current_tier VARCHAR(80),
                recommended_tier VARCHAR(80),
                avg_dtu_percent DECIMAL(5,2),
                monthly_cost DECIMAL(12,2),
                estimated_savings DECIMAL(12,2),
                reason VARCHAR(255),
                detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
                INDEX idx_sql_tenant (tenant_id)
            )
        `);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS StorageRecommendations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                subscription_id VARCHAR(100),
                account_name VARCHAR(255),
                container_name VARCHAR(255),
                current_tier VARCHAR(40),
                recommended_tier VARCHAR(40),
                used_gb DECIMAL(14,2),
                monthly_cost DECIMAL(12,2),
                estimated_savings DECIMAL(12,2),
                reason VARCHAR(255),
                detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
                INDEX idx_stor_tenant (tenant_id)
            )
        `);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS VmssRecommendations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                subscription_id VARCHAR(100),
                resource_group VARCHAR(255),
                vmss_name VARCHAR(255),
                current_sku VARCHAR(80),
                current_capacity INT,
                recommended_capacity INT,
                avg_cpu_percent DECIMAL(5,2),
                has_autoscale BOOLEAN DEFAULT FALSE,
                monthly_cost DECIMAL(12,2),
                estimated_savings DECIMAL(12,2),
                reason VARCHAR(255),
                detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
                INDEX idx_vmss_tenant (tenant_id)
            )
        `);

        // ===== IT-12: VM High Availability =====
        await connection.query(`
            CREATE TABLE IF NOT EXISTS HARecommendations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                subscription_id VARCHAR(100),
                resource_id VARCHAR(1024) NOT NULL,
                resource_name VARCHAR(255),
                resource_type VARCHAR(120),
                issue_type ENUM('no_zone','no_availability_set','no_backup','single_replica','no_geo_redundancy') NOT NULL,
                severity ENUM('low','medium','high','critical') DEFAULT 'medium',
                estimated_risk VARCHAR(255),
                detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
                INDEX idx_ha_tenant (tenant_id, severity)
            )
        `);

        // ===== IT-14: Self-Service Alerts =====
        await connection.query(`
            CREATE TABLE IF NOT EXISTS AlertRules (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                rule_name VARCHAR(255) NOT NULL,
                rule_type ENUM('budget','anomaly','forecast','threshold') NOT NULL,
                scope_subscription_id VARCHAR(100),
                budget_id INT NULL,
                threshold_value DECIMAL(14,4),
                threshold_unit VARCHAR(20) DEFAULT 'USD',
                comparison_operator ENUM('gt','gte','lt','lte','eq') DEFAULT 'gt',
                channel ENUM('email','webhook','teams','slack','servicenow') DEFAULT 'email',
                channel_target VARCHAR(500),
                enabled BOOLEAN DEFAULT TRUE,
                last_triggered_at TIMESTAMP NULL,
                trigger_count INT DEFAULT 0,
                created_by VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
                INDEX idx_alert_tenant (tenant_id, enabled)
            )
        `);
        // backfill column for existing installs
        try {
            await connection.query('ALTER TABLE AlertRules ADD COLUMN budget_id INT NULL');
        } catch (e: any) {
            if (e.code !== 'ER_DUP_FIELDNAME') console.error('Error adding AlertRules.budget_id:', e);
        }

        // ===== IT-16: AAD Expiring Credentials =====
        await connection.query(`
            CREATE TABLE IF NOT EXISTS ExpiringCredentials (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                app_id VARCHAR(100) NOT NULL,
                display_name VARCHAR(255),
                credential_type ENUM('password','certificate') NOT NULL,
                credential_id VARCHAR(120),
                expires_at DATETIME NOT NULL,
                days_till_expiry INT,
                notified_at TIMESTAMP NULL,
                detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
                UNIQUE KEY uniq_cred (tenant_id, app_id, credential_id),
                INDEX idx_cred_tenant_exp (tenant_id, expires_at)
            )
        `);

        // ===== IT-18: Lighthouse Delegations =====
        await connection.query(`
            CREATE TABLE IF NOT EXISTS TenantDelegations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id VARCHAR(255) NOT NULL,
                managed_tenant_id VARCHAR(255) NOT NULL,
                managed_subscription_id VARCHAR(100),
                roles JSON,
                status ENUM('pending','active','revoked') DEFAULT 'pending',
                delegated_by VARCHAR(255),
                delegated_at TIMESTAMP NULL,
                revoked_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
                UNIQUE KEY uniq_deleg (tenant_id, managed_tenant_id, managed_subscription_id)
            )
        `);

        // ===== IT-17: M365 Copilot integration config =====
        await connection.query(`
            CREATE TABLE IF NOT EXISTS M365CopilotConfig (
                tenant_id VARCHAR(255) PRIMARY KEY,
                connector_id VARCHAR(120),
                connector_status ENUM('not_configured','provisioning','ready','error') DEFAULT 'not_configured',
                copilot_studio_agent_id VARCHAR(120),
                last_index_at TIMESTAMP NULL,
                indexed_records INT DEFAULT 0,
                config JSON,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
            )
        `);

        // ===== IT-02: Partner billing extensions for invoicing =====
        const partnerBillingCols = [
            "ADD COLUMN billing_profile_id VARCHAR(255)",
            "ADD COLUMN invoice_section_id VARCHAR(255)",
            "ADD COLUMN customer_id VARCHAR(255)"
        ];
        for (const col of partnerBillingCols) {
            try {
                await connection.query(`ALTER TABLE CostSnapshots ${col};`);
            } catch (e: any) {
                if (e.code !== 'ER_DUP_FIELDNAME') console.error(`Error adding ${col}:`, e);
            }
        }

        connection.release();

        // Aplicar migraciones explícitas versionadas (idempotente).
        try {
            const { runMigrations } = await import('./migrations');
            await runMigrations();
        } catch (migrationsErr) {
            console.error("Migrations runner failed:", migrationsErr);
        }

        dbInitialized = true;
        console.log("Database schema validated/initialized successfully.");
    } catch (error) {
        console.error("Failed to initialize database schema:", error);
    }
}

export async function insertCostSnapshot(tenantId: string, date: string, cost: number, currency: string) {
    await pool.query(
        `INSERT INTO cost_snapshots (tenant_id, sync_date, total_cost_usd, currency)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE total_cost_usd = VALUES(total_cost_usd), currency = VALUES(currency)`,
        [tenantId, date, cost, currency]
    );
}

/**
 * Inserts (or replaces) a detailed FOCUS row into CostSnapshots for the given date.
 * Idempotent via UNIQUE KEY (tenant_id, subscription_id, date, resource_group, service_name).
 */
export async function insertCostSnapshotRow(tenantId: string, date: string, row: {
    subscriptionId: string;
    resourceGroup: string;
    serviceName: string;
    serviceFamily?: string;
    meterCategory?: string;
    meterSubCategory?: string;
    meterName?: string;
    cost: number;
    quantity?: number;
    unitOfMeasure?: string;
}) {
    // Ensure FOCUS columns exist (idempotent — also done at boot)
    for (const col of [
        "ADD COLUMN MeterName VARCHAR(255)",
        "ADD COLUMN MeterSubCategory VARCHAR(255)",
        "ADD COLUMN MeterCategory VARCHAR(255)",
        "ADD COLUMN Quantity DECIMAL(18,6)",
        "ADD COLUMN UnitOfMeasure VARCHAR(64)"
    ]) {
        try { await pool.query(`ALTER TABLE CostSnapshots ${col}`); } catch { /* exists */ }
    }
    await pool.query(
        `INSERT INTO CostSnapshots
            (tenant_id, subscription_id, date, resource_group, service_name,
             ServiceFamily, MeterCategory, MeterSubCategory, MeterName,
             cost_usd, BilledCost, Quantity, UnitOfMeasure, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD')
         ON DUPLICATE KEY UPDATE
             cost_usd = VALUES(cost_usd),
             BilledCost = VALUES(BilledCost),
             ServiceFamily = VALUES(ServiceFamily),
             MeterCategory = VALUES(MeterCategory),
             MeterSubCategory = VALUES(MeterSubCategory),
             MeterName = VALUES(MeterName),
             Quantity = VALUES(Quantity),
             UnitOfMeasure = VALUES(UnitOfMeasure)`,
        [
            tenantId,
            row.subscriptionId || 'default',
            date,
            row.resourceGroup || '*',
            row.serviceName || '',
            row.serviceFamily || null,
            row.meterCategory || null,
            row.meterSubCategory || null,
            row.meterName || null,
            row.cost,
            row.cost,
            row.quantity ?? null,
            row.unitOfMeasure || null
        ]
    );
}

export async function updateTenantHealth(tenantId: string, status: string, errorMsg?: string) {
    await pool.query(
        `INSERT INTO tenant_health (tenant_id, last_sync_at, sync_status, last_error)
         VALUES (?, CURRENT_TIMESTAMP, ?, ?)
         ON DUPLICATE KEY UPDATE last_sync_at = CURRENT_TIMESTAMP, sync_status = VALUES(sync_status), last_error = VALUES(last_error)`,
        [tenantId, status, errorMsg || null]
    );
}

export default pool;
