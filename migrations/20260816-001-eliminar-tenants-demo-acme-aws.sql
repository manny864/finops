-- Migración: Eliminar tenants demo residuales: 'ACME Cloud', 'Prueba AWS' y 'Cliente ACME'
--
-- QUÉ ES. Tenants temporales o creados para pruebas locales/demos antiguas que ya no deben
-- figurar en el inventario de tenants ni en los paneles de administración/superadmin.
--
-- IDEMPOTENCIA. El DELETE por company_name / tenant_id es idempotente y no arroja error si las filas ya no existen.

DELETE FROM Users
 WHERE tenant_id IN (
   SELECT tenant_id FROM Tenants
    WHERE company_name IN ('ACME Cloud', 'Prueba AWS', 'Cliente ACME', 'Cliente Acme', 'Cliente Acme (Demo)')
       OR company_name LIKE '%ACME Cloud%'
       OR company_name LIKE '%Prueba AWS%'
       OR company_name LIKE '%Cliente ACME%'
 );

DELETE FROM Tenants
 WHERE company_name IN ('ACME Cloud', 'Prueba AWS', 'Cliente ACME', 'Cliente Acme', 'Cliente Acme (Demo)')
    OR company_name LIKE '%ACME Cloud%'
    OR company_name LIKE '%Prueba AWS%'
    OR company_name LIKE '%Cliente ACME%';
