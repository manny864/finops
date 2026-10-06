-- Los vendedores escritos a mano quedan vinculados a su comercial (2026-10-06).
--
-- `TenantCommercialDeals.sales_rep_name` es texto libre de antes de SalesReps,
-- y Gestión de Tenants lo marca en ámbar: sin `sales_rep_id` la venta no le
-- devenga comisión a nadie. Se vincula el acuerdo cuyo vendedor se llama igual
-- que un comercial (la collation ignora mayúsculas y acentos), y sólo si ese
-- nombre es de un único comercial no suspendido: con homónimos no hay cómo
-- elegir. Lo que no matchea sigue en ámbar y se elige en Gestión de Tenants.
--
-- Igual que al elegirlo en pantalla (updateCommercialDeal): toma el nombre del
-- comercial y, si el acuerdo estaba al 0 %, también su porcentaje.
UPDATE TenantCommercialDeals d
  JOIN (SELECT MIN(id) AS id, name, MIN(commission_pct) AS pct
          FROM SalesReps
         WHERE status <> 'SUSPENDED'
         GROUP BY name
        HAVING COUNT(*) = 1) r
    ON r.name = TRIM(d.sales_rep_name)
   SET d.sales_rep_id = r.id,
       d.sales_rep_name = r.name,
       d.sales_commission_percent = IF(d.sales_commission_percent > 0, d.sales_commission_percent, r.pct)
 WHERE d.sales_rep_id IS NULL;
