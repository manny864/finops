-- El alta de afiliados nacía con 20 % y el programa de Referido paga 15 %.
-- El 20 % es el de la co-venta, que es del comercial y no pasa por esta tabla:
-- el default venía de antes de que existieran los dos programas.
--
-- Sólo cambia el DEFAULT. Los afiliados ya dados de alta conservan el
-- porcentaje que se les acordó, y cada comisión guarda su propia foto del
-- porcentaje, así que nada de lo devengado se mueve.
ALTER TABLE Affiliates ALTER COLUMN commission_pct SET DEFAULT 15.00;
