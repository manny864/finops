-- Fecha formal de venta y plazo del contrato (MEJ-14, criterio 1).
--
-- `TenantCommercialDeals` ya guardaba QUIÉN vendió y a qué porcentaje, pero no
-- CUÁNDO ni bajo qué modalidad. Sin eso no hay comisiones que calcular: el
-- devengamiento arranca desde la fecha de venta, y la regla que aplica depende
-- del plazo —pago anual liquida el 20% de una vez a partir del 2do mes; pago
-- mensual liquida 2/12 tras el segundo cobro y 1/12 por mes—.
--
-- `sold_at` es NULL para los tenants ya cargados: no se inventa una fecha de
-- venta retroactiva. Una comisión calculada sobre una fecha adivinada es peor
-- que no calcularla, porque parece un dato.
--
-- `contract_term` arranca en 'monthly' porque es la modalidad por defecto de la
-- plataforma; el alta lo setea explícitamente.
ALTER TABLE TenantCommercialDeals
  ADD COLUMN sold_at DATE NULL,
  ADD COLUMN contract_term ENUM('annual','monthly') NOT NULL DEFAULT 'monthly';

CREATE INDEX idx_deals_sold_at ON TenantCommercialDeals (sold_at);
