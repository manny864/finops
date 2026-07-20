-- Foto de perfil personalizada por usuario, usada solo cuando Microsoft
-- Graph (Entra ID) no trae foto para la cuenta (ver
-- src/components/UserProfileMenu.tsx + src/lib/userAvatar.ts).
SET @col_exists = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Users' AND COLUMN_NAME = 'avatar_stored_name'
);
SET @sql = IF(@col_exists = 0,
    'ALTER TABLE Users ADD COLUMN avatar_stored_name VARCHAR(255) NULL',
    'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
