-- SSO SAML: proveedor de identidad, verificación de dominio, aprovisionamiento
-- JIT y resultado de la última prueba de conexión.
--
-- `TenantSSO` ya existía desde `20260728-003` con lo mínimo (org, connection,
-- dominio, enabled). Lo que faltaba es el estado operativo: qué IdP es, si el
-- dominio está verificado, qué pasa con un usuario que entra por SSO y no está
-- en el tenant, y si la última prueba dio verde.
--
-- Una sentencia por línea: el runner parte los archivos por `;` + salto.

ALTER TABLE TenantSSO ADD COLUMN idp_provider VARCHAR(24) NULL;
ALTER TABLE TenantSSO ADD COLUMN is_domain_verified TINYINT(1) NOT NULL DEFAULT 0;

-- JIT apagado por default: aprovisionar automáticamente a cualquiera que
-- autentique contra el IdP del cliente es una decisión que el administrador
-- tiene que tomar explícitamente, no heredar.
ALTER TABLE TenantSSO ADD COLUMN jit_provisioning_enabled TINYINT(1) NOT NULL DEFAULT 0;

-- Rol con el que entra un usuario nuevo por JIT. `Reader` es el mínimo
-- privilegio: si el default fuera Admin, habilitar JIT le daría administración
-- del tenant a todo el directorio del cliente.
ALTER TABLE TenantSSO ADD COLUMN default_role_for_new_users VARCHAR(24) NOT NULL DEFAULT 'Reader';

ALTER TABLE TenantSSO ADD COLUMN last_test_result VARCHAR(16) NULL;
ALTER TABLE TenantSSO ADD COLUMN last_test_detail VARCHAR(400) NULL;
ALTER TABLE TenantSSO ADD COLUMN last_tested_at DATETIME NULL;
