-- El alcance de una regla de alerta se descartaba salvo para suscripción.
--
-- `AlertRules` sólo tenía `scope_subscription_id`, así que el POST de
-- /api/analytics/self-service-alerts guardaba el valor únicamente cuando el
-- alcance era SUBSCRIPTION y escribía NULL en cualquier otro caso. Elegir un
-- grupo de recursos o un centro de costos se perdía en silencio: al recargar,
-- la regla volvía a leerse como "Tenant Completo".
--
-- Dos columnas y no una: el tipo hace falta para saber contra qué comparar el
-- valor (un RG y un centro de costos pueden llamarse igual), y el GET no puede
-- deducirlo del valor solo.
--
-- `scope_subscription_id` se deja como está: lo escriben también
-- /api/budgets/alerts y hay filas viejas que sólo tienen ese dato. El GET lo usa
-- de respaldo cuando `scope_type` todavía es el default.
--
-- Idempotente: dos ALTER separados a propósito. En uno solo, si una columna ya
-- existe MySQL aborta el statement entero y la otra no se crearía (el runner
-- tolera ER_DUP_FIELDNAME por statement, no por columna).
ALTER TABLE AlertRules
    ADD COLUMN scope_type VARCHAR(20) NOT NULL DEFAULT 'TENANT'
    COMMENT 'TENANT | SUBSCRIPTION | RESOURCE_GROUP | TAG';

ALTER TABLE AlertRules
    ADD COLUMN scope_value VARCHAR(255) NULL
    COMMENT 'Id de suscripcion, nombre de resource group o valor del tag CostCenter. NULL = todo el tenant';

-- Las filas que ya tenían suscripción quedan consistentes con el modelo nuevo.
UPDATE AlertRules
   SET scope_type = 'SUBSCRIPTION', scope_value = scope_subscription_id
 WHERE scope_subscription_id IS NOT NULL
   AND scope_subscription_id <> ''
   AND scope_type = 'TENANT';
