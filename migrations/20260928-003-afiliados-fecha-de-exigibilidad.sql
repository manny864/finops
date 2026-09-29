-- Las comisiones de afiliado también tienen fecha de exigibilidad.
--
-- EL AGUJERO
-- `promoverComisionesExigibles()` pasa a `DUE` lo que tiene
-- `payment_due_date <= CURDATE()`. El devengo del COMERCIAL la escribe —es su
-- calendario— pero el del AFILIADO la dejaba en NULL, así que sus comisiones se
-- quedaban en `PENDING` para siempre: nunca aparecían como exigibles en el
-- resumen de liquidación, y la corrida de pago —que barre `DUE`— no las habría
-- levantado nunca. Se vio al armar la primera corrida.
--
-- LA REGLA DEL AFILIADO
-- Hoy no hay ventana de retención para afiliados: es el [A DEFINIR] de §5.3 del
-- borrador del programa, y el sistema no impone ninguna. Entonces la comisión
-- es exigible desde el cobro que la originó, y `payment_due_date` es la fecha
-- de ese cobro. El día que se acuerde una retención, se cambia
-- `MESES_DE_RETENCION_AFILIADO` y esto sigue funcionando igual.
--
-- Backfill de lo ya devengado: sin esto, las comisiones viejas quedarían
-- invisibles para la liquidación aunque las nuevas anden.
UPDATE Commissions
   SET payment_due_date = DATE(COALESCE(billed_at, created_at))
 WHERE beneficiary_type = 'affiliate'
   AND payment_due_date IS NULL
   AND status IN ('PENDING', 'DUE', 'APPROVED');
