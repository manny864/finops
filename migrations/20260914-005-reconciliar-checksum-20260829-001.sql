-- Reconcilia el checksum de 20260829-001-tenant-excluded-subscriptions.sql.
--
-- QUÉ PASÓ. Ese archivo se editó el mismo día, después de que la versión
-- original ya se hubiera aplicado en prod (2026-08-29 15:06 UTC, con éxito). La
-- edición sacó una FOREIGN KEY a Tenants que abortaba el CREATE TABLE con el
-- error 3780 en bases con otra colación. Como el runner no re-ejecuta lo ya
-- aplicado, prod se quedó con la FK y con el checksum del contenido viejo, y
-- desde entonces cada arranque del contenedor imprime "fue modificada desde su
-- aplicación" -- varias veces por deploy, durante dos semanas y media.
--
-- POR QUÉ SE RECONCILIA Y NO SE REVIERTE EL ARCHIVO. Volver el .sql a la
-- versión con FK silenciaría el aviso, pero reintroduciría el CREATE TABLE que
-- falla en cualquier base nueva -- y un fallo ahí no es idempotente para el
-- runner, así que bloquea todas las migraciones siguientes. El archivo de hoy
-- es el que hay que conservar; lo que estaba desactualizado era el registro.
--
-- La diferencia entre prod (con FK) y una base nueva (sin FK) queda explicada
-- en el encabezado de la propia 20260829-001. Esto no re-ejecuta nada ni toca
-- TenantExcludedSubscriptions: sólo pone al día la fila de SchemaMigrations.
--
-- El hash va literal a propósito: si alguien vuelve a editar aquel archivo, el
-- aviso reaparece, que es exactamente para lo que existe el chequeo.
UPDATE SchemaMigrations
   SET checksum = 'ce04c4dc1ba7ec8fed1ab74490f6c6970d3d864abe962387f4e2ad8793b6fbae'
 WHERE file_name = '20260829-001-tenant-excluded-subscriptions.sql';
