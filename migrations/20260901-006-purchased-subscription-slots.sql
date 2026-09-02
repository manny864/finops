-- Cierre del lazo de cobro de add-ons de capacidad (MEJ-15 fase 2).
--
-- POR QUÉ UNA COLUMNA NUEVA Y NO REUSAR `max_allowed_subscriptions`
-- Esa columna guarda un tope ABSOLUTO, y como tal se desincroniza: si el
-- cliente compra 2 slots en Professional (2+2=4) y después sube a Business
-- (3 incluidas), el absoluto 4 quedaría por DEBAJO de lo que ya le
-- corresponde, o habría que recalcularlo en cada cambio de plan. Guardando lo
-- COMPRADO por separado, el tope efectivo es `incluidas_del_plan + compradas`
-- y sobrevive a cualquier cambio de tier sin tocar nada.
--
-- `max_allowed_subscriptions` se conserva como override manual para casos
-- comerciales puntuales (ver getEffectiveSubscriptionLimit).
ALTER TABLE TenantSubscriptions
    ADD COLUMN purchased_subscription_slots INT NOT NULL DEFAULT 0
    COMMENT 'Suscripciones extra compradas como add-on; se suma a las del plan';
