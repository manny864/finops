-- Migration: 20260907-001-affiliates-program.sql
--
-- Programa de afiliados: un tercero promociona la plataforma con un link
-- propio y cobra un porcentaje de lo que paguen los tenants que trajo.
--
-- Tres decisiones que quedan grabadas en el esquema, porque son las que evitan
-- pagar de más:
--
-- 1. `AffiliateCommissions.paddle_transaction_id` es UNIQUE. Paddle reintenta
--    la entrega de un webhook ante cualquier respuesta que no sea 2xx, y puede
--    reenviar el mismo evento. Sin esta clave, un reintento de
--    `transaction.completed` inserta una segunda comisión por el mismo cobro y
--    al afiliado se le paga dos veces. Con la clave, el INSERT IGNORE del
--    handler es idempotente por construcción y no depende de que el código
--    acierte a chequear antes.
--
-- 2. Los montos NO se llaman `_usd`. Paddle cobra en la moneda del comprador y
--    `BillingTransactions` ya guarda `amount` + `currency`; nombrar la columna
--    en dólares seria mentir sobre lo que contiene y arrastraría el error a
--    cada reporte. Se guarda la moneda al lado, igual que en facturación.
--
-- 3. `commission_pct` se copia en cada fila. Es una foto del porcentaje
--    vigente cuando se devengó: si mañana se renegocia el acuerdo del
--    afiliado, el histórico ya liquidado no se reescribe solo.
--
-- La atribución es de primer toque y única por tenant (`uq_referral_tenant`):
-- un tenant pertenece a un solo afiliado y no se re-atribuye. El código llega
-- en una cookie escribible por el cliente, así que el guard de auto-referido
-- (email del afiliado == email de un usuario del tenant) va en la aplicación,
-- donde puede consultar Users.

-- La collation va explícita: el default de la base es `utf8mb4_0900_ai_ci` pero
-- `Tenants.tenant_id` es `utf8mb4_unicode_ci`, y MySQL exige collation idéntica
-- a los dos lados de una FK. Sin el COLLATE, el CREATE TABLE muere con
-- ER_FK_INCOMPATIBLE_COLUMNS. Es la convención del resto del directorio.

CREATE TABLE IF NOT EXISTS Affiliates (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    referral_code VARCHAR(64) NOT NULL,
    commission_pct DECIMAL(5,2) NOT NULL DEFAULT 20.00,
    status ENUM('ACTIVE', 'SUSPENDED', 'PENDING') NOT NULL DEFAULT 'ACTIVE',
    -- Cómo se le paga. Texto libre a propósito: no guardamos datos bancarios
    -- estructurados en esta base, sólo la referencia que usa quien liquida.
    payout_method VARCHAR(50) NULL,
    payout_reference VARCHAR(255) NULL,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_affiliate_email (email),
    UNIQUE KEY uq_affiliate_code (referral_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS AffiliateReferrals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    affiliate_id VARCHAR(36) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    referred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_referral_tenant (tenant_id),
    KEY idx_referral_affiliate (affiliate_id),
    CONSTRAINT fk_referral_affiliate FOREIGN KEY (affiliate_id) REFERENCES Affiliates(id) ON DELETE CASCADE,
    CONSTRAINT fk_referral_tenant FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS AffiliateCommissions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    affiliate_id VARCHAR(36) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    paddle_transaction_id VARCHAR(255) NOT NULL,
    paddle_subscription_id VARCHAR(255) NULL,
    -- Base de cálculo: el subtotal pre-impuestos del cobro, en la moneda del
    -- cobro. Es el mismo campo que ya usa handleTransactionCompleted, para que
    -- comisión y facturación no discrepen.
    base_amount DECIMAL(12, 4) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    commission_pct DECIMAL(5,2) NOT NULL,
    commission_amount DECIMAL(12, 4) NOT NULL,
    status ENUM('PENDING', 'APPROVED', 'PAID', 'REVERSED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    billed_at DATETIME NULL,
    paid_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_commission_transaction (paddle_transaction_id),
    KEY idx_commission_affiliate_status (affiliate_id, status),
    KEY idx_commission_tenant (tenant_id),
    CONSTRAINT fk_commission_affiliate FOREIGN KEY (affiliate_id) REFERENCES Affiliates(id) ON DELETE CASCADE,
    CONSTRAINT fk_commission_tenant FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
