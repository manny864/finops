-- Create TaggingPolicies table for governance/tags mandatory tagging policies
CREATE TABLE IF NOT EXISTS TaggingPolicies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    policy_name VARCHAR(255) NOT NULL,
    is_required TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_tenant_policy (tenant_id, policy_name),
    INDEX idx_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed defaults with runtime column detection to support legacy table variants.
SET @tenant_col = (
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'TaggingPolicies' AND column_name = 'tenant_id'
    ) THEN 'tenant_id'
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'TaggingPolicies' AND column_name = 'tenantId'
    ) THEN 'tenantId'
    ELSE NULL
  END
);

SET @policy_col = (
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'TaggingPolicies' AND column_name = 'policy_name'
    ) THEN 'policy_name'
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'TaggingPolicies' AND column_name = 'policyName'
    ) THEN 'policyName'
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'TaggingPolicies' AND column_name = 'tag_key'
    ) THEN 'tag_key'
    ELSE NULL
  END
);

SET @required_col = (
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'TaggingPolicies' AND column_name = 'is_required'
    ) THEN 'is_required'
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'TaggingPolicies' AND column_name = 'isRequired'
    ) THEN 'isRequired'
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'TaggingPolicies' AND column_name = 'required'
    ) THEN 'required'
    ELSE NULL
  END
);

SET @seed_sql = IF(
  @tenant_col IS NULL OR @policy_col IS NULL OR @required_col IS NULL,
  'SELECT 1',
  CONCAT(
    'INSERT IGNORE INTO TaggingPolicies (`', @tenant_col, '`, `', @policy_col, '`, `', @required_col, '`) ',
    'SELECT t.tenant_id, p.policy_name, 1 ',
    'FROM (SELECT DISTINCT tenant_id FROM Users) t ',
    'CROSS JOIN (',
    'SELECT ''Environment'' AS policy_name ',
    'UNION ALL SELECT ''Role'' ',
    'UNION ALL SELECT ''CostCenter'' ',
    'UNION ALL SELECT ''Department''',
    ') p'
  )
);

PREPARE seed_stmt FROM @seed_sql;
EXECUTE seed_stmt;
DEALLOCATE PREPARE seed_stmt;
