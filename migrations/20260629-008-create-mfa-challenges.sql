-- Migration: 20260629-008-create-mfa-challenges.sql
-- Crea MfaChallenges: desafíos de MFA de un solo uso para operaciones sensibles.
--
-- Por qué existe esta migración recién ahora: la tabla NUNCA se creó por
-- migración. En el VPS estaba hecha a mano, así que
-- 20260630-001-mfa-challenge-attempts.sql (que le hace ALTER para agregar
-- attempt_count) funcionaba ahí y falla en cualquier base nueva con
-- ER_NO_SUCH_TABLE. Verificado 2026-07-28 al montar el esquema en Azure.
--
-- El nombre la ordena antes del ALTER: el runner aplica los archivos ordenados
-- por nombre, así que la tabla existe para cuando corre 20260630-001.
--
-- attempt_count NO va acá a propósito: lo agrega esa migración posterior, que
-- ya es idempotente. Duplicarlo haría divergir las dos definiciones.
--
-- Esquema derivado del uso real:
--   src/app/api/mfa/challenge/route.ts         (INSERT)
--   src/app/api/mfa/verify-challenge/route.ts  (SELECT/UPDATE)
--   src/lib/requireMfaChallenge.ts             (SELECT)

CREATE TABLE IF NOT EXISTS MfaChallenges (
    -- uuidv4() del lado de la app; ascii porque es un UUID, no texto.
    id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci PRIMARY KEY,
    user_email VARCHAR(255) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    operation VARCHAR(64) NOT NULL,
    -- sha256 en hex = 64 caracteres. Nullable: el challenge puede no llevar
    -- payload (mfaCrypto.hashPayload sólo se llama si hay uno).
    payload_hash VARCHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
    expires_at DATETIME NOT NULL,
    -- NULL mientras no se consumió; requireMfaChallenge exige que esté seteado.
    consumed_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Las tres consultas filtran por (id, user_email, tenant_id[, operation]).
    -- La PK sobre id ya resuelve el acceso; este índice cubre el barrido de
    -- limpieza de challenges vencidos.
    KEY idx_mfa_challenges_expiry (expires_at),

    CONSTRAINT fk_mfa_challenges_tenant
        FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
);
