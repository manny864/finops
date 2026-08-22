-- Seguridad (2FA): bitácora de eventos de autenticación y credenciales
-- WebAuthn/FIDO2.
--
-- El TOTP y los códigos de recuperación ya existían (`Users.mfa_*` desde
-- `20260728-003`). Lo que faltaba era la trazabilidad — quién entró, con qué
-- método, desde dónde — y el segundo factor por llave física.
--
-- Una sentencia por línea: el runner parte los archivos por `;` + salto.

CREATE TABLE IF NOT EXISTS AuthAuditLogs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    event_type VARCHAR(48) NOT NULL,
    method_used VARCHAR(24) NULL,
    is_success TINYINT(1) NOT NULL DEFAULT 1,
    ip_address VARCHAR(64) NULL,
    user_agent VARCHAR(400) NULL,
    detail VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_auth_audit_user (tenant_id, user_email, created_at),
    INDEX idx_auth_audit_event (tenant_id, event_type, created_at),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
);

-- Credenciales WebAuthn/FIDO2 (llaves físicas y passkeys).
--
-- `credential_id` es la clave natural que devuelve el navegador y es única a
-- nivel global, no por usuario: una misma llave no puede registrarse dos veces.
-- `public_key` guarda la COSE key en base64url tal como la entrega
-- @simplewebauthn/server; no es un secreto (es la mitad pública), pero igual
-- vive sólo del lado servidor.
--
-- `counter` es el contador de firmas del autenticador: sirve para detectar
-- clonación de la llave. Se guarda como BIGINT porque algunos autenticadores
-- reportan valores altos.
CREATE TABLE IF NOT EXISTS UserWebAuthnCredentials (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    credential_id VARCHAR(512) NOT NULL,
    public_key TEXT NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0,
    device_type VARCHAR(32) NULL,
    is_backed_up TINYINT(1) NOT NULL DEFAULT 0,
    transports VARCHAR(120) NULL,
    friendly_name VARCHAR(120) NULL,
    last_used_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_webauthn_credential (credential_id),
    INDEX idx_webauthn_user (tenant_id, user_email),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
);

-- Challenge de registro/autenticación en curso. Vive en la fila del usuario y
-- no en una cookie porque WebAuthn exige que el servidor sea quien recuerde el
-- challenge que emitió: aceptar el que devuelve el cliente anularía la
-- protección contra replay.
ALTER TABLE Users ADD COLUMN webauthn_challenge VARCHAR(255) NULL;
ALTER TABLE Users ADD COLUMN webauthn_challenge_expires_at DATETIME NULL;
