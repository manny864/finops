SET @has_col := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'AICostSnapshots'
    AND COLUMN_NAME = 'request_count'
);

SET @ddl := IF(
  @has_col = 0,
  'ALTER TABLE AICostSnapshots ADD COLUMN request_count BIGINT NOT NULL DEFAULT 0 AFTER model_name',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
