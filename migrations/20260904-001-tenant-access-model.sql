-- Migration: 20260904-001-tenant-access-model.sql
--
-- Como llega la plataforma a las suscripciones de un tenant.
--
-- Hasta hoy habia un solo modelo y estaba implicito: un app registration en el
-- directorio del CLIENTE, cuyo client id/secret guardamos por tenant. Por eso
-- `getAzureCredential` arma siempre `ClientSecretCredential(tenantDelCliente,...)`.
--
-- Azure Lighthouse es al reves: el service principal vive en NUESTRO directorio,
-- el token se emite contra NUESTRO tenant, y ARM lo resuelve hacia las
-- suscripciones que el cliente delego. Sin esta columna no hay forma de saber
-- contra que autoridad pedir el token, y hoy el onboarding por Lighthouse emite
-- la plantilla, registra la delegacion... y despues consulta con la credencial
-- del modelo viejo, que en un tenant Lighthouse no existe.
--
-- Default 'app_registration': los tenants que ya estan no cambian de
-- comportamiento. Un tenant solo pasa a 'lighthouse' cuando se verifica contra
-- Resource Graph que la delegacion existe de verdad --no cuando emitimos la
-- plantilla, que es apenas una intencion--.
--
-- VARCHAR y no ENUM, siguiendo el criterio de 20260728-002: un ENUM obliga a un
-- ALTER cada vez que se agrega un modelo (managed identity, workload identity
-- federation).

ALTER TABLE Tenants ADD COLUMN access_model VARCHAR(32) NOT NULL DEFAULT 'app_registration';

-- El barrido y el panel filtran por esto para elegir la vía de credencial.
CREATE INDEX idx_tenants_access_model ON Tenants (access_model);

-- Cuando se verifico por ultima vez que la delegacion sigue viva. El cliente
-- puede revocarla desde su portal sin avisarnos, y a diferencia de un secreto
-- que expira, una delegacion revocada no da un error distinguible: da 403 o
-- simplemente cero suscripciones.
ALTER TABLE TenantDelegations ADD COLUMN verified_at DATETIME NULL;
ALTER TABLE TenantDelegations ADD COLUMN verification_error TEXT NULL;
