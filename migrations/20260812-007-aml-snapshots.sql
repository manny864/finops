CREATE TABLE IF NOT EXISTS AzureMLSnapshots (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenantId CHAR(36) NOT NULL,
  snapshotDate DATE NOT NULL,
  resourceId VARCHAR(500) NOT NULL,
  resourceName VARCHAR(255) NOT NULL,
  region VARCHAR(100) NOT NULL,
  monthlyCostUSD DECIMAL(12, 2) DEFAULT 0,
  usage_computeHours BIGINT DEFAULT 0,
  usage_gpuHours BIGINT DEFAULT 0,
  usage_storageGB BIGINT DEFAULT 0,
  utilizationPercent INT DEFAULT 0,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_tenant_resource_date (tenantId, resourceId, snapshotDate),
  INDEX idx_tenant_date (tenantId, snapshotDate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
