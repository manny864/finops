-- Usuarios y Permisos: estado de cuenta, 2FA cacheado, último acceso, quién
-- invitó y alcance de módulos.
--
-- Se extiende la tabla `Users` en lugar de crear una `TenantUsers` paralela:
-- `Users` es la que consultan `requireTenantAccess`, `requireTenantRole` y
-- `hasSystemRole`. Un segundo padrón de identidades obligaría a mantener los dos
-- sincronizados y cualquier deriva entre ellos sería un agujero de RBAC.
--
-- Idempotencia: el runner tolera ER_DUP_FIELDNAME / ER_DUP_KEYNAME, así que un
-- ALTER repetido no rompe la corrida. Una sentencia por línea.

-- ACTIVE / INVITED / DISABLED. Default ACTIVE: todas las filas existentes son
-- usuarios que ya entraron al menos una vez.
ALTER TABLE Users ADD COLUMN account_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE';

-- Cache del registro de MFA en el DIRECTORIO del cliente (Entra ID,
-- reports/authenticationMethods/userRegistrationDetails).
--
-- NO reutiliza `Users.mfa_enabled`: esa columna ya existe desde
-- `20260728-003` y significa otra cosa — que el usuario enroló TOTP en ESTA
-- plataforma (ver src/lib/mfa.ts y /api/mfa/status). Son dos hechos distintos:
-- alguien puede tener 2FA en Entra ID y no en la plataforma, o al revés.
-- Colapsarlos en una columna haría que el panel de Usuarios mostrara el estado
-- equivocado y que el KPI de cumplimiento midiera la plataforma en vez del
-- directorio.
--
-- NULL = Entra ID todavía no se consultó, que NO es lo mismo que "no tiene
-- 2FA": la UI muestra "Pendiente" sólo cuando Graph respondió que no está
-- registrado.
ALTER TABLE Users ADD COLUMN entra_mfa_registered TINYINT(1) NULL;
ALTER TABLE Users ADD COLUMN entra_mfa_checked_at DATETIME NULL;

ALTER TABLE Users ADD COLUMN last_login_at DATETIME NULL;
ALTER TABLE Users ADD COLUMN invited_by VARCHAR(255) NULL;

-- Alcance de módulos del SaaS (JSON array de SaaSModuleKey). Se deriva de
-- `permissions` cuando está en NULL: ver moduleFromRoleTags() en
-- tenantUsers.service.ts. `permissions` sigue siendo la fuente que gatea el
-- Sidebar y RouteTierGate; esta columna guarda la selección explícita del drawer
-- para poder reconstruirla tal cual la dejó el administrador.
ALTER TABLE Users ADD COLUMN allowed_modules JSON DEFAULT NULL;

-- El listado de usuarios filtra y ordena por tenant; el KPI de 2FA agrega por
-- tenant + mfa_enabled.
ALTER TABLE Users ADD INDEX idx_users_tenant_status (tenant_id, account_status);
