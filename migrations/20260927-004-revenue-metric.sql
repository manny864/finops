-- Migration: 20260927-004-revenue-metric.sql
-- MEJ-37 fase 2 — ingresos como métrica de negocio.
--
-- LA FASE 2 YA ESTABA CASI ENTERA. El endpoint de ingesta con API Key
-- (`/api/unit-metrics/ingest`, scope `write:metrics`), la serie temporal
-- (`TenantUnitMetrics`) y el costo unitario existen desde Unit Economics. Lo
-- único que faltaba para calcular MARGEN BRUTO era el numerador: no había forma
-- de decirle a la plataforma cuánto se factura.
--
-- SE SUMA AL ENUM QUE YA EXISTE en vez de crear una tabla de ingresos aparte:
-- reusa la ingesta, el upsert, la validación y el histórico. Una tabla nueva
-- habría duplicado las cuatro cosas para guardar exactamente la misma forma
-- (tenant, fecha, número).
--
-- OJO, Y QUEDA ESCRITO: REVENUE es DINERO, no un conteo. Su `scale` es 1 y no
-- se lo debe tratar como volumen — "costo por unidad de REVENUE" es una
-- división válida (da 1 menos el margen) pero se lee como otra cosa, así que la
-- pantalla de Unit Economics lo excluye del selector de denominador.

ALTER TABLE TenantUnitMetrics
    MODIFY COLUMN metric_type
        ENUM('DAU','MAU','TRANSACTIONS','API_CALLS','AI_TOKENS','STORAGE_TB','REVENUE') NOT NULL;
