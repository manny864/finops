-- Migration: 20260728-003-sincronizar-esquema-vps.sql
--
-- Trae al control de migraciones TODO lo que existía en la base del VPS y nunca
-- entró a un .sql. No es una migración escrita a mano: el DDL se tomó LITERAL de
--   mysqldump --no-data  sobre finops_db del VPS (2026-07-28)
-- para no inferir tipos, largos, índices ni claves foráneas.
--
-- Alcance: 37 tablas y 37 columnas.
--
-- Contexto: montar el esquema desde cero en Azure destapó que el VPS tenía 80
-- tablas mientras las migraciones creaban 43. Los casos que fueron apareciendo
-- de a uno (MfaChallenges, Anomalies, las columnas FOCUS de CostSnapshots,
-- Tenants.sync_status) eran los primeros de una lista larga. Seguir a ciegas
-- habría implicado adivinar 37 definiciones leyendo SELECTs.
--
-- SIN `DEFAULT CHARSET/COLLATE` por tabla, a propósito. El dump los traía como
-- utf8mb4_0900_ai_ci (el default del VPS), pero Terraform crea la base de Azure
-- con utf8mb4_unicode_ci (modules/mysql/main.tf). Una FOREIGN KEY exige collation
-- IDÉNTICA en ambos lados, así que las tablas nuevas chocaban contra Tenants con
--   ER_FK_INCOMPATIBLE_COLUMNS
-- Sin la cláusula, cada tabla hereda el default de SU base y el esquema queda
-- coherente en cualquier entorno. Verificado 2026-07-28.
--
-- OJO al probar en local: `docker run mysql:8` usa 0900_ai_ci y NO reproduce
-- este fallo. Hay que arrancarlo con --collation-server=utf8mb4_unicode_ci.
--
-- FOREIGN_KEY_CHECKS en 0 durante los CREATE: el orden del dump no garantiza
-- que una tabla se cree antes que otra que la referencia. Se restaura al final.
-- Es el mismo recurso que usa mysqldump en sus propios volcados.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `AcademyProgress` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `tenant_id` varchar(255) NOT NULL,
  `module_id` varchar(100) NOT NULL,
  `completed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_module` (`user_id`,`module_id`),
  KEY `tenant_id` (`tenant_id`),
  CONSTRAINT `AcademyProgress_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `Users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `AcademyProgress_ibfk_2` FOREIGN KEY (`tenant_id`) REFERENCES `Tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `AllocationRules` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(36) NOT NULL,
  `resourceName` varchar(255) NOT NULL,
  `targetCostCenter` varchar(255) NOT NULL,
  `allocationPercentage` decimal(5,2) NOT NULL,
  `createdAt` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenantId`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `AppServiceRecommendations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `subscription_id` varchar(100) DEFAULT NULL,
  `resource_group` varchar(255) DEFAULT NULL,
  `plan_name` varchar(255) NOT NULL,
  `current_sku` varchar(80) DEFAULT NULL,
  `recommended_sku` varchar(80) DEFAULT NULL,
  `avg_cpu_percent` decimal(5,2) DEFAULT NULL,
  `avg_mem_percent` decimal(5,2) DEFAULT NULL,
  `monthly_cost` decimal(12,2) DEFAULT NULL,
  `estimated_savings` decimal(12,2) DEFAULT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `detected_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_as_tenant` (`tenant_id`),
  CONSTRAINT `AppServiceRecommendations_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `Tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `BillingTransactions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `paddle_transaction_id` varchar(255) DEFAULT NULL,
  `paddle_subscription_id` varchar(255) DEFAULT NULL,
  `amount` decimal(12,2) DEFAULT NULL,
  `currency` varchar(10) DEFAULT NULL,
  `status` varchar(50) DEFAULT NULL,
  `billed_at` datetime DEFAULT NULL,
  `raw_event` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `paddle_transaction_id` (`paddle_transaction_id`),
  KEY `idx_tenant_date` (`tenant_id`,`billed_at` DESC),
  CONSTRAINT `BillingTransactions_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `Tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `cost_snapshots` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) DEFAULT NULL,
  `sync_date` date DEFAULT NULL,
  `total_cost_usd` decimal(10,2) DEFAULT NULL,
  `currency` varchar(10) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_tenant_sync_date` (`tenant_id`,`sync_date`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `CostCenterBudgets` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `cost_center_name` varchar(255) NOT NULL,
  `monthly_budget_usd` decimal(10,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_tenant_costcenter` (`tenant_id`,`cost_center_name`),
  CONSTRAINT `CostCenterBudgets_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `Tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `DataPipelineEvents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `source` varchar(50) NOT NULL,
  `period_end` datetime NOT NULL,
  `ingested_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `record_count` int DEFAULT '0',
  `status` varchar(30) DEFAULT 'ok',
  `error_msg` text,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_source_ingested` (`tenant_id`,`source`,`ingested_at`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `DataResidencyChanges` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `changed_by` varchar(255) NOT NULL,
  `from_region` varchar(20) DEFAULT NULL,
  `to_region` varchar(20) NOT NULL,
  `reason` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `ExpiringCredentials` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `app_id` varchar(100) NOT NULL,
  `display_name` varchar(255) DEFAULT NULL,
  `credential_type` enum('password','certificate') NOT NULL,
  `credential_id` varchar(120) DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `days_till_expiry` int DEFAULT NULL,
  `notified_at` timestamp NULL DEFAULT NULL,
  `detected_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_cred` (`tenant_id`,`app_id`,`credential_id`),
  KEY `idx_cred_tenant_exp` (`tenant_id`,`expires_at`),
  CONSTRAINT `ExpiringCredentials_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `Tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `HARecommendations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `subscription_id` varchar(100) DEFAULT NULL,
  `resource_id` varchar(1024) NOT NULL,
  `resource_name` varchar(255) DEFAULT NULL,
  `resource_type` varchar(120) DEFAULT NULL,
  `issue_type` enum('no_zone','no_availability_set','no_backup','single_replica','no_geo_redundancy') NOT NULL,
  `severity` enum('low','medium','high','critical') DEFAULT 'medium',
  `estimated_risk` varchar(255) DEFAULT NULL,
  `detected_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ha_tenant` (`tenant_id`,`severity`),
  CONSTRAINT `HARecommendations_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `Tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `LegalAcceptances` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `user_email` varchar(255) NOT NULL,
  `document_type` enum('dpa','terms','privacy') NOT NULL,
  `document_version` varchar(50) NOT NULL,
  `accepted_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tenant_doc` (`tenant_id`,`document_type`,`document_version`),
  KEY `idx_tenant` (`tenant_id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `M365CopilotConfig` (
  `tenant_id` varchar(255) NOT NULL,
  `connector_id` varchar(120) DEFAULT NULL,
  `connector_status` enum('not_configured','provisioning','ready','error') DEFAULT 'not_configured',
  `copilot_studio_agent_id` varchar(120) DEFAULT NULL,
  `last_index_at` timestamp NULL DEFAULT NULL,
  `indexed_records` int DEFAULT '0',
  `config` json DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`),
  CONSTRAINT `M365CopilotConfig_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `Tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `MACCCommitments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `billing_account_id` varchar(255) NOT NULL,
  `billing_profile_id` varchar(255) DEFAULT NULL,
  `commitment_amount` decimal(16,2) NOT NULL,
  `consumed_amount` decimal(16,2) DEFAULT '0.00',
  `remaining_amount` decimal(16,2) DEFAULT '0.00',
  `burn_rate_monthly` decimal(16,2) DEFAULT '0.00',
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `currency` varchar(10) DEFAULT 'USD',
  `last_updated` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_macc` (`tenant_id`,`billing_account_id`,`start_date`),
  CONSTRAINT `MACCCommitments_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `Tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `MarketplaceEvents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) DEFAULT NULL,
  `marketplace` enum('azure','aws') NOT NULL,
  `event_type` varchar(100) NOT NULL,
  `subscription_id` varchar(255) DEFAULT NULL,
  `raw_payload` json DEFAULT NULL,
  `processed` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_subscription` (`subscription_id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_marketplace_event` (`marketplace`,`event_type`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `MaturityAssessments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `score` int NOT NULL,
  `level` enum('Crawl','Walk','Run') NOT NULL,
  `assessment_data` json NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `tenant_id` (`tenant_id`),
  CONSTRAINT `MaturityAssessments_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `Tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `NotificationChannels` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `type` enum('slack','teams','email') NOT NULL,
  `name` varchar(255) NOT NULL,
  `config_json` json NOT NULL,
  `severity_filter` varchar(50) DEFAULT 'info,warning,error',
  `enabled` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_tenant_type` (`tenant_id`,`type`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `NotificationLog` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `channel_id` int DEFAULT NULL,
  `channel_type` varchar(50) DEFAULT NULL,
  `title` varchar(500) DEFAULT NULL,
  `message` text,
  `severity` varchar(50) DEFAULT NULL,
  `status` enum('success','failed') NOT NULL,
  `error_message` text,
  `sent_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_date` (`tenant_id`,`sent_at`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `OnboardingProgress` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `step_welcome` enum('pending','in_progress','completed','skipped') DEFAULT 'pending',
  `step_azure_sp` enum('pending','in_progress','completed','skipped') DEFAULT 'pending',
  `step_first_sync` enum('pending','in_progress','completed','skipped') DEFAULT 'pending',
  `step_first_budget` enum('pending','in_progress','completed','skipped') DEFAULT 'pending',
  `step_notifications` enum('pending','in_progress','completed','skipped') DEFAULT 'pending',
  `completed_at` datetime DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tenant_id` (`tenant_id`),
  CONSTRAINT `OnboardingProgress_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `Tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `OpenDataCommitmentEligibility` (
  `meter_id` varchar(120) NOT NULL,
  `meter_name` varchar(255) DEFAULT NULL,
  `service_family` varchar(100) DEFAULT NULL,
  `product_name` varchar(255) DEFAULT NULL,
  `sku_name` varchar(255) DEFAULT NULL,
  `region` varchar(120) DEFAULT NULL,
  `ri_eligible` tinyint(1) DEFAULT '0',
  `sp_eligible` tinyint(1) DEFAULT '0',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`meter_id`),
  KEY `idx_service_family` (`service_family`),
  KEY `idx_sku` (`sku_name`,`region`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `OpenDataPricingUnits` (
  `unit_of_measure` varchar(120) NOT NULL,
  `distinct_units` decimal(18,6) DEFAULT NULL,
  `pricing_block_size` decimal(18,6) DEFAULT NULL,
  `pricing_unit` varchar(120) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`unit_of_measure`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `OpenDataRegions` (
  `resource_location` varchar(120) NOT NULL,
  `region_id` varchar(120) DEFAULT NULL,
  `region_name` varchar(200) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`resource_location`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `OpenDataResourceTypes` (
  `resource_type` varchar(255) NOT NULL,
  `singular_display_name` varchar(255) DEFAULT NULL,
  `plural_display_name` varchar(255) DEFAULT NULL,
  `icon` varchar(255) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`resource_type`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `OpenDataServices` (
  `consumed_service` varchar(255) NOT NULL,
  `resource_type` varchar(255) NOT NULL,
  `service_name` varchar(255) DEFAULT NULL,
  `service_category` varchar(100) DEFAULT NULL,
  `service_model` varchar(100) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`consumed_service`,`resource_type`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `OpenDataSyncState` (
  `dataset` varchar(60) NOT NULL,
  `last_sync_at` timestamp NULL DEFAULT NULL,
  `last_status` varchar(20) DEFAULT NULL,
  `row_count` int DEFAULT '0',
  `source_url` varchar(500) DEFAULT NULL,
  `error_msg` text,
  PRIMARY KEY (`dataset`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `PlatformIncidents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(500) NOT NULL,
  `severity` enum('minor','major','critical') NOT NULL,
  `status` enum('investigating','identified','monitoring','resolved') NOT NULL,
  `started_at` datetime NOT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `description` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_started` (`started_at`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `PlatformStatusSnapshots` (
  `id` int NOT NULL AUTO_INCREMENT,
  `overall_status` enum('operational','degraded','down') NOT NULL,
  `db_latency_ms` int DEFAULT NULL,
  `azure_sync_ratio` decimal(5,4) DEFAULT NULL,
  `components_json` json DEFAULT NULL,
  `captured_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_captured` (`captured_at`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `PublicApiKeys` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `name` varchar(255) NOT NULL,
  `key_hash` char(64) NOT NULL,
  `key_prefix` char(12) NOT NULL,
  `scopes` json NOT NULL DEFAULT (json_array(_utf8mb4'read:cost',_utf8mb4'read:resources')),
  `rate_limit_per_min` int NOT NULL DEFAULT '60',
  `enabled` tinyint(1) DEFAULT '1',
  `last_used_at` datetime DEFAULT NULL,
  `created_by` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `key_hash` (`key_hash`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_prefix` (`key_prefix`),
  CONSTRAINT `PublicApiKeys_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `Tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `RecommendationActions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `recommendation_id` varchar(500) NOT NULL,
  `category` varchar(50) DEFAULT NULL,
  `resource_id` varchar(1024) DEFAULT NULL,
  `status` enum('open','accepted','implemented','dismissed','suppressed') DEFAULT 'open',
  `user_email` varchar(255) DEFAULT NULL,
  `reason` text,
  `expires_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_rec` (`tenant_id`,`recommendation_id`),
  KEY `idx_tenant_status` (`tenant_id`,`status`),
  CONSTRAINT `RecommendationActions_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `Tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `RemediationRequests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `resource_id` varchar(1024) NOT NULL,
  `resource_name` varchar(255) NOT NULL,
  `action_type` varchar(100) NOT NULL,
  `estimated_savings` decimal(12,2) DEFAULT '0.00',
  `status` enum('Pending','Approved','Rejected') DEFAULT 'Pending',
  `requested_by` varchar(255) NOT NULL,
  `requested_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `resolved_at` timestamp NULL DEFAULT NULL,
  `resolved_by` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `tenant_id` (`tenant_id`),
  CONSTRAINT `RemediationRequests_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `Tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `SignupEvents` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `user_email` varchar(255) NOT NULL,
  `event_type` enum('signup_started','signup_completed','trial_started','onboarding_completed','trial_extended','trial_expired','converted_to_paid','churned') NOT NULL,
  `plan` varchar(50) DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant_event` (`tenant_id`,`event_type`),
  KEY `idx_event_date` (`event_type`,`created_at`),
  CONSTRAINT `SignupEvents_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `Tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `SqlDbRecommendations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `subscription_id` varchar(100) DEFAULT NULL,
  `server_name` varchar(255) DEFAULT NULL,
  `db_name` varchar(255) DEFAULT NULL,
  `current_tier` varchar(80) DEFAULT NULL,
  `recommended_tier` varchar(80) DEFAULT NULL,
  `avg_dtu_percent` decimal(5,2) DEFAULT NULL,
  `monthly_cost` decimal(12,2) DEFAULT NULL,
  `estimated_savings` decimal(12,2) DEFAULT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `detected_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sql_tenant` (`tenant_id`),
  CONSTRAINT `SqlDbRecommendations_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `Tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `SSOSessions` (
  `id` varchar(64) NOT NULL,
  `tenant_id` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `workos_user_id` varchar(255) DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tenant` (`tenant_id`),
  KEY `idx_email` (`email`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `StorageRecommendations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `subscription_id` varchar(100) DEFAULT NULL,
  `account_name` varchar(255) DEFAULT NULL,
  `container_name` varchar(255) DEFAULT NULL,
  `current_tier` varchar(40) DEFAULT NULL,
  `recommended_tier` varchar(40) DEFAULT NULL,
  `used_gb` decimal(14,2) DEFAULT NULL,
  `monthly_cost` decimal(12,2) DEFAULT NULL,
  `estimated_savings` decimal(12,2) DEFAULT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `detected_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_stor_tenant` (`tenant_id`),
  CONSTRAINT `StorageRecommendations_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `Tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `TaggingPolicies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `tag_key` varchar(255) NOT NULL,
  `required` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `tenant_id` (`tenant_id`),
  CONSTRAINT `TaggingPolicies_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `Tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `TenantDelegations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `managed_tenant_id` varchar(255) NOT NULL,
  `managed_subscription_id` varchar(100) DEFAULT NULL,
  `roles` json DEFAULT NULL,
  `status` enum('pending','active','revoked') DEFAULT 'pending',
  `delegated_by` varchar(255) DEFAULT NULL,
  `delegated_at` timestamp NULL DEFAULT NULL,
  `revoked_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_deleg` (`tenant_id`,`managed_tenant_id`,`managed_subscription_id`),
  CONSTRAINT `TenantDelegations_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `Tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `TenantSSO` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `workos_org_id` varchar(255) DEFAULT NULL,
  `workos_connection_id` varchar(255) DEFAULT NULL,
  `domain` varchar(255) DEFAULT NULL,
  `enabled` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tenant_id` (`tenant_id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `VmssRecommendations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` varchar(255) NOT NULL,
  `subscription_id` varchar(100) DEFAULT NULL,
  `resource_group` varchar(255) DEFAULT NULL,
  `vmss_name` varchar(255) DEFAULT NULL,
  `current_sku` varchar(80) DEFAULT NULL,
  `current_capacity` int DEFAULT NULL,
  `recommended_capacity` int DEFAULT NULL,
  `avg_cpu_percent` decimal(5,2) DEFAULT NULL,
  `has_autoscale` tinyint(1) DEFAULT '0',
  `monthly_cost` decimal(12,2) DEFAULT NULL,
  `estimated_savings` decimal(12,2) DEFAULT NULL,
  `reason` varchar(255) DEFAULT NULL,
  `detected_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_vmss_tenant` (`tenant_id`),
  CONSTRAINT `VmssRecommendations_ibfk_1` FOREIGN KEY (`tenant_id`) REFERENCES `Tenants` (`tenant_id`) ON DELETE CASCADE
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;


-- Columnas faltantes en tablas que YA existían. El runner trata
-- ER_DUP_FIELDNAME como idempotente, así que reejecutar es seguro.
-- Users.scope y Users.permissions son las que rompían /api/admin/config/users
-- con 500 y dejaban al frontend sin poder resolver isSuperAdmin.

ALTER TABLE `AICostSnapshots` ADD COLUMN `application` varchar(120) DEFAULT NULL;
ALTER TABLE `AICostSnapshots` ADD COLUMN `team` varchar(120) DEFAULT NULL;
ALTER TABLE `AICostSnapshots` ADD COLUMN `environment` varchar(60) DEFAULT NULL;
ALTER TABLE `AICostSnapshots` ADD COLUMN `tags` json DEFAULT NULL;
ALTER TABLE `Budgets` ADD COLUMN `active` tinyint(1) NOT NULL DEFAULT '1';
ALTER TABLE `Budgets` ADD COLUMN `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE `CostSnapshots` ADD COLUMN `PublisherName` varchar(100) DEFAULT NULL;
ALTER TABLE `CostSnapshots` ADD COLUMN `SubAccountId` varchar(100) DEFAULT NULL;
ALTER TABLE `CostSnapshots` ADD COLUMN `CommitmentDiscountId` varchar(255) DEFAULT NULL;
ALTER TABLE `CostSnapshots` ADD COLUMN `MeterId` varchar(255) DEFAULT NULL;
ALTER TABLE `CostSnapshots` ADD COLUMN `MeterName` varchar(255) DEFAULT NULL;
ALTER TABLE `CostSnapshots` ADD COLUMN `MeterCategory` varchar(255) DEFAULT NULL;
ALTER TABLE `CostSnapshots` ADD COLUMN `MeterSubCategory` varchar(255) DEFAULT NULL;
ALTER TABLE `CostSnapshots` ADD COLUMN `Quantity` decimal(18,6) DEFAULT NULL;
ALTER TABLE `CostSnapshots` ADD COLUMN `UnitOfMeasure` varchar(64) DEFAULT NULL;
ALTER TABLE `CostSnapshots` ADD COLUMN `ServiceFamily` varchar(100) DEFAULT NULL;
ALTER TABLE `CostSnapshots` ADD COLUMN `ingested_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `CostSnapshots` ADD COLUMN `billing_profile_id` varchar(255) DEFAULT NULL;
ALTER TABLE `CostSnapshots` ADD COLUMN `invoice_section_id` varchar(255) DEFAULT NULL;
ALTER TABLE `CostSnapshots` ADD COLUMN `customer_id` varchar(255) DEFAULT NULL;
ALTER TABLE `Tenants` ADD COLUMN `last_sync_at` timestamp NULL DEFAULT NULL;
ALTER TABLE `Tenants` ADD COLUMN `last_error_message` text;
ALTER TABLE `Tenants` ADD COLUMN `marketplace_source` enum('direct','azure_marketplace','aws_marketplace') DEFAULT 'direct';
ALTER TABLE `Tenants` ADD COLUMN `marketplace_subscription_id` varchar(255) DEFAULT NULL;
ALTER TABLE `Tenants` ADD COLUMN `marketplace_plan_id` varchar(255) DEFAULT NULL;
ALTER TABLE `Tenants` ADD COLUMN `last_trial_reminder_at` datetime DEFAULT NULL;
ALTER TABLE `Tenants` ADD COLUMN `data_residency` enum('EU','US','LATAM','APAC','GLOBAL') DEFAULT 'GLOBAL';
ALTER TABLE `Tenants` ADD COLUMN `data_residency_locked_at` datetime DEFAULT NULL;
ALTER TABLE `Tenants` ADD COLUMN `access_until` datetime DEFAULT NULL;
ALTER TABLE `Tenants` ADD COLUMN `logo_stored_name` varchar(255) DEFAULT NULL;
ALTER TABLE `Users` ADD COLUMN `scope` json DEFAULT NULL;
ALTER TABLE `Users` ADD COLUMN `mfa_enabled` tinyint(1) DEFAULT '0';
ALTER TABLE `Users` ADD COLUMN `mfa_secret_encrypted` text;
ALTER TABLE `Users` ADD COLUMN `mfa_recovery_codes_hash` json DEFAULT NULL;
ALTER TABLE `Users` ADD COLUMN `mfa_last_used_at` datetime DEFAULT NULL;
ALTER TABLE `Users` ADD COLUMN `cost_center` varchar(255) DEFAULT NULL;
ALTER TABLE `Users` ADD COLUMN `permissions` json DEFAULT NULL;
