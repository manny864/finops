-- Dimensión de asignación en el agregado diario de costos.
--
-- PROBLEMA
-- `CostSnapshots` guarda el costo agregado por (fecha, agrupación, servicio) y
-- su clave única no incluía ninguna dimensión de etiquetas. Como consecuencia,
-- el sync no podía persistir el costo separado por centro de costo o equipo:
-- dos filas del mismo día y servicio con distinto `CostCenter` colapsaban por
-- `ON DUPLICATE KEY UPDATE` y la segunda pisaba a la primera.
--
-- Eso dejaba a los tenants AWS con todo el gasto en "Sin asignar" y bloqueaba
-- cuatro capabilities del FinOps Framework: Allocation, Chargeback, Unit
-- Economics y Showback por equipo.
--
-- SOLUCIÓN
-- Se agrega `allocation_tag_hash`, la huella de las etiquetas de asignación de
-- la fila (ver `src/lib/allocationTags.ts`), y pasa a formar parte de la clave
-- única.
--
-- POR QUÉ NO ES UNA COLUMNA GENERADA
-- El hash no sale de aplicar una función de MySQL sobre `Tags`: antes hay que
-- normalizar los nombres de etiqueta —en AWS son case-sensitive, así que
-- `CostCenter`, `costcenter` y `cost-center` conviven como tres etiquetas
-- distintas— y resolver alias. Esa lógica vive en la aplicación y no se puede
-- expresar en una columna generada sin duplicarla en SQL, donde quedaría libre
-- de tests y se desincronizaría.
--
-- POR QUÉ ES SEGURO PARA LOS DATOS YA PERSISTIDOS
-- La columna arranca en '' para todas las filas existentes, así que la clave
-- nueva es equivalente a la vieja para ellas: no puede generar duplicados ni
-- fallar por colisión. Y ampliar una clave única sólo **relaja** la
-- restricción, nunca rechaza filas que antes entraban.
--
-- El agregado de Azure no llena `Tags` (ver `src/modules/storage/db.ts`), así
-- que su hash sigue siendo '' y su comportamiento no cambia en absoluto.

-- 1. La columna. ASCII porque es un hash hexadecimal: ocupa 1 byte por
--    carácter en vez de 4, y así la clave única entra holgada en el límite de
--    3072 bytes de InnoDB.
ALTER TABLE CostSnapshots
    ADD COLUMN allocation_tag_hash VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT '' AFTER Tags;

-- 2. La clave nueva se crea ANTES de borrar la vieja: si este paso fallara, la
--    tabla se queda con la protección anterior en vez de quedar sin ninguna.
ALTER TABLE CostSnapshots
    ADD UNIQUE KEY unique_tenant_date_rg_service_sub_tag
    (tenant_id, subscription_id, date, resource_group, service_name, allocation_tag_hash);

-- 3. Recién ahora se retira la clave vieja, que es la que impedía separar el
--    costo por etiqueta.
ALTER TABLE CostSnapshots
    DROP INDEX unique_tenant_date_rg_service_sub;

-- 4. Índice de apoyo para las vistas de asignación, que filtran por tenant y
--    rango de fechas y agrupan por etiqueta.
ALTER TABLE CostSnapshots
    ADD INDEX idx_tenant_date_allocation (tenant_id, date, allocation_tag_hash);
