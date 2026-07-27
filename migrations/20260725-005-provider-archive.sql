-- Fase 3 — Qué pasa con los datos del proveedor que se pierde cuando un tenant
-- Enterprise con `provider = 'both'` baja de tier.
-- (Riesgo abierto #7 de docs/aws-multicloud-handoff.md.)
--
-- Politica elegida: ARCHIVADO REVERSIBLE CON VENTANA DE GRACIA. Bajar de plan
-- NUNCA borra datos en el acto. El proveedor que se pierde pasa a un estado
-- archivado: se corta la ingesta (que es lo que cuesta plata y lo que el tenant
-- dejo de pagar) pero la serie historica se conserva, exportable, durante
-- PROVIDER_ARCHIVE_RETENTION_DAYS dias. Recien ahi se purga.
--
-- Por que no borrar en el downgrade:
--   1. El downgrade lo dispara un webhook asincrono de Paddle/Marketplace. No
--      hay nadie mirando la pantalla que pueda confirmar un borrado masivo.
--   2. Un downgrade por tarjeta rechazada (PAST_DUE -> plan menor) es
--      reversible en horas. Borrar seria destruir datos de un cliente que
--      vuelve.
--   3. El valor de una plataforma FinOps ES la serie historica. Se reconstruye
--      solo parcialmente: Cost Explorer retiene 12-14 meses y el CUR depende de
--      que el bucket del cliente siga vivo.
--   4. Portabilidad de datos (GDPR art. 20): el cliente tiene que poder
--      llevarse lo suyo. Sin ventana de gracia, bajar de plan seria secuestro
--      de datos.
--
-- Por que no retener para siempre: FocusLineItems es grain recurso/hora, son
-- millones de filas por cuenta por mes (riesgo #2 del handoff). Retencion
-- infinita de tenants que ya no pagan ese proveedor es costo puro.

-- Denormalizacion de los dos campos calientes en Tenants, para que el gating
-- por request (¿esta ruta AWS sigue habilitada para este tenant?) sea un solo
-- SELECT sobre la fila del tenant que las rutas ya leen, y no un JOIN contra
-- la tabla de transiciones en cada llamada.
ALTER TABLE Tenants ADD COLUMN provider_archived ENUM('azure','aws') NULL;
ALTER TABLE Tenants ADD COLUMN provider_purge_at DATETIME NULL;

-- Historial de transiciones. Append-only: cada downgrade abre una fila en
-- GRACE, que termina en RESTORED (volvio a Enterprise a tiempo) o PURGED.
-- Se conserva despues de resolverse porque es la evidencia de auditoria de un
-- borrado de datos del cliente.
CREATE TABLE IF NOT EXISTS TenantProviderTransitions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,

    from_tier VARCHAR(32) NOT NULL,
    to_tier VARCHAR(32) NOT NULL,

    -- Siempre 'both' hoy (es el unico caso que genera perdida), pero se guarda
    -- explicito para no tener que inferirlo si manana hay mas combinaciones.
    from_provider ENUM('azure','aws','both') NOT NULL,
    retained_provider ENUM('azure','aws') NOT NULL,
    archived_provider ENUM('azure','aws') NOT NULL,

    -- 'auto': lo eligio el sistema por gasto en el webhook (nadie mirando).
    -- 'user' / 'superadmin': se corrigio despues, durante la gracia.
    election_source ENUM('auto','user','superadmin') NOT NULL DEFAULT 'auto',

    status ENUM('GRACE','RESTORED','PURGED') NOT NULL DEFAULT 'GRACE',

    archived_at DATETIME NOT NULL,
    purge_at DATETIME NOT NULL,

    -- Idempotencia de los avisos previos a la purga (T-30 / T-7). Sin esto el
    -- cron diario mandaria el mismo mail 30 veces seguidas.
    notified_t30_at DATETIME NULL,
    notified_t7_at DATETIME NULL,

    resolved_at DATETIME NULL,
    -- Conteo de filas borradas por tabla. Evidencia de que se purgo y cuanto.
    purged_rows JSON NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
    -- Barrido del cron de purga: arranca por status + fecha.
    INDEX idx_pending (status, purge_at),
    INDEX idx_tenant_status (tenant_id, status)
);

-- Corte de ingesta sin perder credenciales. El archivado es reversible en un
-- clic, asi que NO se borra el role_arn ni el external_id: forzar un
-- re-onboarding completo (crear de nuevo el rol IAM en la cuenta del cliente)
-- a alguien que volvio a Enterprise a los 3 dias es friccion gratuita.
-- Lo que sí se corta es el sync, que es donde esta el costo real: Cost Explorer
-- cobra USD 0.01 por request. Cuenta deshabilitada = cero requests = cero costo.
-- Las credenciales se destruyen recien en la purga, junto con los datos.
ALTER TABLE AwsAccounts ADD COLUMN disabled_at DATETIME NULL;
ALTER TABLE AwsAccounts ADD COLUMN disabled_reason VARCHAR(255) NULL;
