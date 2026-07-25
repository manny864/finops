-- Fase 2 — Identidad propia (login sin Entra) para tenants AWS.
--
-- Contexto: hasta hoy `tenant_id` ERA el GUID del tenant de Entra y
-- `Users.entra_oid` era obligatorio. AWS no tiene un IdP equivalente a Entra
-- (ver docs/aws-multicloud-handoff.md §3.1), así que los tenants AWS se
-- autentican contra un JWT propio y su `tenant_id` es un UUID generado.
--
-- Un usuario es "local" si y solo si `password_hash IS NOT NULL`. Un usuario
-- de Entra sigue teniendo `entra_oid` y `password_hash NULL`. Los dos tipos
-- conviven en la misma tabla y el resto del sistema no los distingue.

-- entra_oid deja de ser obligatorio: los usuarios locales no tienen uno.
-- La UNIQUE KEY (entra_oid, tenant_id) que ya existe NO estorba: MySQL trata
-- los NULL como distintos entre sí, así que varios usuarios locales por
-- tenant conviven sin colisionar.
ALTER TABLE Users MODIFY COLUMN entra_oid VARCHAR(255) NULL;

ALTER TABLE Users ADD COLUMN password_hash VARCHAR(255) NULL;
ALTER TABLE Users ADD COLUMN email_verified_at DATETIME NULL;

-- ponytail: indice NO unico a proposito. La UNIQUE KEY (email, tenant_id) es
-- lo correcto a futuro, pero aplicarla a ciegas sobre produccion puede fallar
-- si hay emails duplicados o NULL heredados del modelo Entra, y el runner de
-- migraciones ignora ER_DUP_ENTRY -> el constraint quedaria silenciosamente
-- sin crear, que es peor que no tenerlo. Mientras tanto la unicidad se
-- garantiza en codigo (createLocalUser, dentro de la transaccion).
-- Para promoverlo, correr primero:
--   SELECT tenant_id, email, COUNT(*) c FROM Users
--    GROUP BY tenant_id, email HAVING c > 1;
-- y recien con 0 filas, una migracion nueva con el ADD UNIQUE.
ALTER TABLE Users ADD INDEX idx_email_tenant (email, tenant_id);

-- Proveedor del tenant. Pertenece conceptualmente a la Fase 3 (exclusividad
-- por tier + switch de UI), pero se adelanta aca porque el signup local ya
-- tiene que escribir 'aws' al crear el tenant. Default 'azure' => todos los
-- tenants existentes quedan correctos sin backfill.
ALTER TABLE Tenants ADD COLUMN provider ENUM('azure','aws','both') NOT NULL DEFAULT 'azure';

-- Tokens de un solo uso para verificacion de email, reset de password e
-- invitacion de usuarios.
--
-- Se guarda el SHA-256 del token, nunca el token en claro: una lectura de esta
-- tabla (dump, backup filtrado, SQLi de solo lectura) no debe alcanzar para
-- tomar control de una cuenta.
CREATE TABLE IF NOT EXISTS AuthTokens (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    purpose ENUM('verify_email','password_reset','invite') NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
    UNIQUE KEY uniq_token_hash (token_hash),
    INDEX idx_lookup (tenant_id, email, purpose),
    INDEX idx_expiry (expires_at)
);
