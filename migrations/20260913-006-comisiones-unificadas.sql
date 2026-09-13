-- Libro mayor único de comisiones: afiliados y comerciales en la misma tabla
-- (MEJ-14, criterios 2 a 4).
--
-- POR QUÉ UNA SOLA TABLA Y NO `SalesCommissionLedger` APARTE
-- El motor de comisiones ya existía para afiliados (`AffiliateCommissions`,
-- migración 20260907-001): montos en Decimal, foto del porcentaje vigente,
-- idempotencia por transacción de Paddle y reversión ante reembolso. Lo único
-- que cambia entre un afiliado y un comercial es CUÁNDO devenga —el afiliado un
-- % de cada cobro, el comercial un calendario sobre el valor anual—, no cómo se
-- guarda ni cómo se liquida.
--
-- Dos tablas para lo mismo divergen: es exactamente lo que pasó con los tres
-- catálogos de precios (MEJ-32). Y hay un caso concreto que una tabla aparte
-- vuelve invisible: alguien que es afiliado Y comercial cobraría por dos lados
-- sin que ninguna consulta lo muestre junto.
--
-- QUÉ SE GUARDA Y POR QUÉ
--
-- 1. `beneficiary_type` + `beneficiary_id` en vez de dos columnas nullables
--    (`affiliate_id` / `sales_rep_id`). Con dos columnas, cada consulta tiene
--    que acordarse de filtrar la otra en NULL, y la primera que se olvide suma
--    comisiones de los dos lados.
--
-- 2. `beneficiary_id` NO lleva FK. MySQL no tiene FK condicional por tipo, así
--    que apunta a `Affiliates.id` o a `SalesReps.id` según el tipo. El borrado
--    en cascada que tenía la tabla vieja se reemplaza por la regla de negocio:
--    un beneficiario con comisiones liquidadas no se borra, se suspende
--    (`status = 'SUSPENDED'`) — borrar el histórico de plata pagada no es algo
--    que deba poder hacer un DELETE.
--
-- 3. `installment_number` / `installment_total`: la cuota del calendario del
--    comercial (3 de 12). NULL para los afiliados, que no tienen calendario.
--    El UNIQUE sobre la cuota es lo que impide devengar dos veces el mismo mes;
--    en MySQL los NULL no colisionan entre sí, así que el mismo índice no
--    estorba a los afiliados.
--
-- 4. `payment_due_date`: cuándo se le puede pagar. Es la regla de exigibilidad
--    de MEJ-14 hecha dato: en venta anual el 20% se devenga con el cobro pero
--    recién es exigible a partir del 2do mes; en mensual, las cuotas 1 y 2
--    vencen juntas tras el segundo cobro.
--
-- 5. `base_amount` + `currency`, igual que en facturación y por el mismo motivo
--    que la migración de afiliados: Paddle cobra en la moneda del comprador y
--    llamar `_usd` a una columna que puede traer euros arrastra el error a cada
--    reporte.
--
-- LA TABLA VIEJA NO SE BORRA ACÁ. Los datos se copian y `AffiliateCommissions`
-- queda intacta hasta verificar en producción que el libro nuevo cuadra. Es
-- plata liquidada: el DROP va en una migración posterior, no en la misma que
-- mueve los datos.

-- Comerciales de la casa. Espejo de `Affiliates` a propósito: es el mismo
-- objeto (alguien a quien se le liquida un porcentaje) con otra puerta de
-- entrada. `TenantCommercialDeals.sales_rep_name` ya existía como texto libre y
-- se mantiene: es el histórico de quién vendió, y dos comerciales pueden
-- llamarse igual — por eso ahora hay un id.
CREATE TABLE IF NOT EXISTS SalesReps (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    commission_pct DECIMAL(5,2) NOT NULL DEFAULT 20.00,
    status ENUM('ACTIVE', 'SUSPENDED', 'PENDING') NOT NULL DEFAULT 'ACTIVE',
    payout_method VARCHAR(50) NULL,
    payout_reference VARCHAR(255) NULL,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_sales_rep_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A quién se le liquida la venta de este tenant. NULL en los deals ya cargados:
-- tienen el nombre en texto y nadie puede decidir por ellos a qué comercial de
-- la tabla corresponden.
ALTER TABLE TenantCommercialDeals
  ADD COLUMN sales_rep_id VARCHAR(36) NULL;

CREATE INDEX idx_deals_sales_rep ON TenantCommercialDeals (sales_rep_id);

CREATE TABLE IF NOT EXISTS Commissions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    beneficiary_type ENUM('affiliate', 'sales_rep') NOT NULL,
    beneficiary_id VARCHAR(36) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,

    -- El cobro que la originó. El afiliado devenga por cobro; el comercial
    -- devenga la cuota del mes que ese cobro habilita.
    paddle_transaction_id VARCHAR(255) NOT NULL,
    paddle_subscription_id VARCHAR(255) NULL,

    base_amount DECIMAL(12, 4) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    commission_pct DECIMAL(5,2) NOT NULL,
    commission_amount DECIMAL(12, 4) NOT NULL,

    -- Calendario del comercial. NULL para afiliados.
    installment_number TINYINT UNSIGNED NULL,
    installment_total TINYINT UNSIGNED NULL,

    status ENUM('PENDING', 'DUE', 'APPROVED', 'PAID', 'REVERSED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    billed_at DATETIME NULL,
    payment_due_date DATE NULL,
    paid_at DATETIME NULL,
    paid_by_admin VARCHAR(255) NULL,
    payment_reference VARCHAR(255) NULL,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Idempotencia ante el reintento de webhook de Paddle. Lleva el tipo porque
    -- un mismo cobro puede pagarle al afiliado Y al comercial: son dos filas
    -- legítimas de la misma transacción.
    UNIQUE KEY uq_commission_event (beneficiary_type, paddle_transaction_id),

    -- Un comercial no devenga dos veces la misma cuota, aunque Paddle mande dos
    -- cobros el mismo mes (reintento de pago fallido, prorrateo de un cambio de
    -- plan). Los NULL de los afiliados no colisionan entre sí en MySQL.
    UNIQUE KEY uq_commission_installment (beneficiary_type, beneficiary_id, tenant_id, installment_number),

    KEY idx_commission_beneficiary_status (beneficiary_type, beneficiary_id, status),
    KEY idx_commission_tenant (tenant_id),
    KEY idx_commission_due (status, payment_due_date),
    -- El nombre va distinto del `fk_commission_tenant` de `AffiliateCommissions`
    -- a propósito: en InnoDB los nombres de constraint son únicos por BASE, no
    -- por tabla. Con el mismo nombre, este CREATE TABLE muere con
    -- ER_FK_DUP_NAME mientras la tabla vieja siga existiendo -- y el runner lo
    -- toma por idempotente, así que la tabla no se crea y el error recién
    -- aparece en el INSERT de abajo.
    CONSTRAINT fk_ledger_tenant FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Las comisiones de afiliados ya devengadas pasan al libro único. `INSERT
-- IGNORE` para que reaplicar la migración no duplique: el UNIQUE de
-- (tipo, transacción) es el que decide.
INSERT IGNORE INTO Commissions
    (beneficiary_type, beneficiary_id, tenant_id, paddle_transaction_id, paddle_subscription_id,
     base_amount, currency, commission_pct, commission_amount, status, billed_at, paid_at, created_at)
SELECT 'affiliate', affiliate_id, tenant_id, paddle_transaction_id, paddle_subscription_id,
       base_amount, currency, commission_pct, commission_amount, status, billed_at, paid_at, created_at
FROM AffiliateCommissions;
