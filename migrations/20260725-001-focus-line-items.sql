-- Tabla FOCUS a grain de recurso/hora, provider-agnostica (AWS + Azure).
--
-- Por que existe: CostSnapshots tiene UNIQUE KEY
-- (tenant_id, subscription_id, date, resource_group, service_name) y `date` es
-- DATE, asi que NO puede representar linea de CUR a nivel recurso/hora. El
-- pipeline de CUR agregaba en memoria por (date, region, service) para poder
-- entrar en esa clave, tirando ResourceId y la hora — justo lo que se necesita
-- para rightsizing, deteccion de huerfanos y chargeback por recurso.
--
-- CostSnapshots se mantiene como esta (los dashboards leen de ahi el agregado
-- diario). Esta tabla es la fuente granular; el agregado se sigue escribiendo
-- en paralelo.
--
-- Idempotencia: AWS RE-EMITE (restates) el CUR del periodo en curso varias
-- veces al mes con un assemblyId nuevo. Por eso NO hay unique key por linea:
-- la semantica correcta es reemplazar el periodo completo, no upsertear linea
-- por linea. El ingestor inserta con el assemblyId nuevo y despues borra las
-- filas del mismo (tenant, cuenta, periodo) que tengan un assemblyId distinto.

CREATE TABLE IF NOT EXISTS FocusLineItems (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,

    -- Identidad de proveedor / cuenta (FOCUS 1.1)
    ProviderName VARCHAR(50) NOT NULL,
    PublisherName VARCHAR(100) NULL,
    InvoiceIssuerName VARCHAR(128) NULL,
    BillingAccountId VARCHAR(100) NOT NULL,          -- AWS payer / Azure tenant
    SubAccountId VARCHAR(100) NOT NULL,              -- AWS linked account / Azure subscription

    -- Servicio y recurso
    ServiceName VARCHAR(255) NOT NULL,
    ServiceCategory VARCHAR(100) NULL,
    Region VARCHAR(64) NULL,
    ResourceId VARCHAR(512) NOT NULL DEFAULT '',     -- ARN en AWS, resourceId en Azure
    ResourceType VARCHAR(128) NULL,

    -- Ventanas de tiempo
    ChargePeriodStart DATETIME NOT NULL,             -- DATETIME, no DATE: soporta grain horario
    ChargePeriodEnd DATETIME NOT NULL,
    BillingPeriodStart DATE NULL,
    BillingPeriodEnd DATE NULL,

    -- Costos. DECIMAL(18,8) y no (12,4): a grain horario por recurso hay
    -- lineas de fracciones de centavo que a 4 decimales redondean a 0 y
    -- desaparecen del total al sumar millones de filas.
    BilledCost DECIMAL(18,8) NOT NULL DEFAULT 0,     -- lo facturado en el periodo
    EffectiveCost DECIMAL(18,8) NOT NULL DEFAULT 0,  -- con descuentos de compromiso aplicados
    AmortizedCost DECIMAL(18,8) NOT NULL DEFAULT 0,  -- upfront de RI/Savings Plan prorrateado
    BillingCurrency VARCHAR(10) NOT NULL DEFAULT 'USD',

    -- Uso y pricing
    UsageQuantity DECIMAL(24,8) NULL,
    UsageUnit VARCHAR(64) NULL,
    PricingCategory VARCHAR(64) NULL,                -- On-Demand | Reserved | Spot | Savings Plan
    ChargeCategory VARCHAR(64) NULL,                 -- Usage | Tax | Credit | Adjustment | Fee
    CommitmentDiscountId VARCHAR(255) NULL,

    Tags JSON NULL,

    -- Trazabilidad del ingest
    source_assembly_id VARCHAR(128) NULL,            -- assemblyId del manifest CUR
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,

    -- Barrido por periodo (dashboards, exports FOCUS)
    INDEX idx_tenant_period (tenant_id, ChargePeriodStart),
    -- Drill-through por recurso (rightsizing, huerfanos). Prefijo 191 porque
    -- un ARN completo a utf8mb4 no entra en el limite de indice de InnoDB.
    INDEX idx_tenant_resource (tenant_id, ResourceId(191)),
    -- Reemplazo de periodo al restatear el CUR + filtro por linked account
    INDEX idx_replace_period (tenant_id, SubAccountId, BillingPeriodStart, source_assembly_id),
    -- Vistas multi-cloud comparativas
    INDEX idx_provider_period (tenant_id, ProviderName, ChargePeriodStart)
);
