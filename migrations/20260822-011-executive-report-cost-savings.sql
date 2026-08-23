-- Reporte Ejecutivo: persistir el costo y el ahorro del snapshot en el job.
--
-- El historial ofrece ordenar por "Mayor costo" y "Mayor ahorro", pero
-- `ExecutiveReportJobs` no guardaba ninguno de los dos, así que ambas opciones
-- caían a `ORDER BY id DESC` y el selector prometía algo que no cumplía.
--
-- Se guardan como columnas del job y no se recalculan al listar: son un
-- SNAPSHOT del momento en que se generó el reporte. Recalcularlos contra
-- CostSnapshots devolvería el costo de hoy, no el que el reporte informó, y dos
-- aperturas del mismo reporte mostrarían cifras distintas.
--
-- DECIMAL y no float (Regla Cero). DECIMAL(14,2) admite hasta ~999.999.999.999,99,
-- de sobra para el gasto mensual de un tenant.

ALTER TABLE ExecutiveReportJobs
    ADD COLUMN total_cost_usd DECIMAL(14,2) NULL DEFAULT NULL;

ALTER TABLE ExecutiveReportJobs
    ADD COLUMN total_savings_usd DECIMAL(14,2) NULL DEFAULT NULL;

-- NULL = job anterior a esta migración, sin snapshot guardado. Se distingue de
-- 0.00 (reporte real que no encontró ahorros) a propósito: la UI muestra "—"
-- para lo desconocido en vez de afirmar que no hubo ahorro.

-- El ORDER BY del historial filtra por tenant + status y ordena por estas
-- columnas; sin índice es un filesort sobre todo el historial del tenant.
CREATE INDEX idx_execjobs_tenant_cost ON ExecutiveReportJobs (tenant_id, total_cost_usd);

CREATE INDEX idx_execjobs_tenant_savings ON ExecutiveReportJobs (tenant_id, total_savings_usd);
