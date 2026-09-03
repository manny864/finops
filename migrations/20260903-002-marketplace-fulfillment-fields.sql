-- Publicación en Azure Marketplace: campos de fulfillment que faltaban.
--
-- `marketplace_subscription_id`, `marketplace_plan_id` y `marketplace_source` ya
-- existían; se agregan los cuatro restantes que pide el SaaS Fulfillment API v2.
--
-- POR QUÉ IMPORTA CADA UNO
--  - `marketplace_offer_id`: un publisher puede tener varias ofertas. Sin esto
--    no se puede distinguir de cuál vino la suscripción al reconciliar contra
--    Partner Center.
--  - `marketplace_status`: el estado que reporta MICROSOFT (Subscribed,
--    Suspended, Unsubscribed). NO se mezcla con `subscription_status`, que es el
--    estado comercial nuestro y también lo mueven Paddle y las acciones de
--    SuperAdmin: si se pisaran, una suspensión de Azure borraría el motivo real
--    de una baja gestionada por otro canal.
--  - `marketplace_purchaser_email` y `marketplace_purchaser_tenant_id`: quién
--    compró y desde qué directorio. El comprador NO siempre es quien después
--    usa la plataforma, y en un reclamo de facturación es el dato que Microsoft
--    pide para conciliar.
ALTER TABLE Tenants
    ADD COLUMN marketplace_offer_id VARCHAR(255) NULL COMMENT 'Oferta de Partner Center de la que vino la suscripción',
    ADD COLUMN marketplace_status VARCHAR(50) NULL COMMENT 'Estado según Microsoft: Subscribed/Suspended/Unsubscribed. Distinto de subscription_status',
    ADD COLUMN marketplace_purchaser_email VARCHAR(320) NULL COMMENT 'Quién compró en Azure Marketplace',
    ADD COLUMN marketplace_purchaser_tenant_id VARCHAR(255) NULL COMMENT 'Directorio Entra desde el que se compró';

-- El webhook busca el tenant POR subscription_id en cada evento de Microsoft:
-- sin índice, cada ChangePlan/Suspend/Unsubscribe hace un full scan de Tenants.
ALTER TABLE Tenants
    ADD INDEX idx_marketplace_sub (marketplace_subscription_id);
