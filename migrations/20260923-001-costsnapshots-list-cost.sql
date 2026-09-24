-- Migration: 20260923-001-costsnapshots-list-cost.sql
-- Guarda el precio de lista de cada fila de costo. Sin esto no hay ahorro medible.
--
-- EL DEFECTO QUE CIERRA. `src/lib/focus/mapper.ts` hacia `rec.ListCost = billed`
-- porque no habia de donde sacar otra cosa: CostSnapshots no tenia ninguna
-- columna con el precio publico. Resultado: en el export FOCUS, ListCost y
-- BilledCost salian SIEMPRE con el mismo numero, y la especificacion define
-- ListCost justamente para que `ListCost - EffectiveCost` de el ahorro. O sea
-- que cualquier consumidor del export que calculara ahorro obtenia cero,
-- tuviera el cliente los descuentos que tuviera. Un cero silencioso, que es
-- peor que un error.
--
-- DE DONDE SALEN LOS DATOS. El export FOCUS de Azure ya trae las dos columnas;
-- se estaban tirando al ingerir. Verificado en la referencia del dataset
-- (learn.microsoft.com, "FOCUS cost and usage details file schema", 1.0 y
-- 1.2-preview): columna 30 ListCost, 25 ContractedCost. No hace falta llamar a
-- ninguna API nueva ni tarifar nada contra la Retail API.
--
-- POR QUE NULL Y NO 0. NULL significa "no sabemos el precio de lista de esta
-- fila", que es el caso real de las filas que entran por la Query API de Cost
-- Management (esa API no devuelve precio publico). Con DEFAULT 0 esas filas
-- entrarian al calculo de la tasa de ahorro como "100% de descuento" y la
-- inflarian. La tasa las excluye y reporta cuanto gasto quedo sin evaluar.
--
-- Tipos: DECIMAL(18,8), igual que BilledCost/EffectiveCost (20260724-001), para
-- que las cuatro columnas de costo se puedan restar sin perder decimales.

ALTER TABLE CostSnapshots ADD COLUMN ListCost DECIMAL(18,8) NULL;

-- Precio negociado x cantidad, sin descuentos por compromiso. Es el escalon
-- intermedio entre ListCost y EffectiveCost: separa el descuento de contrato
-- (lo que ya se negocio) del de compromiso (lo que aporta la gestion de
-- reservas). El mapper tambien la estaba inventando, con `ContractedCost =
-- EffectiveCost`.
ALTER TABLE CostSnapshots ADD COLUMN ContractedCost DECIMAL(18,8) NULL;
