# SOP — Compute Efficiency & Unit Economics Dashboard

## 1. Propósito y Alcance
Procedimiento operativo estándar para el cálculo, monitoreo, optimización de tarifas y gobierno de Unit Economics de cómputo en Microsoft Azure (`$/vCore` y `$/GiB RAM`), análisis de mix de arquitectura (ARM / AMD / Intel), generaciones de CPU, utilización efectiva de núcleos y recomendaciones de Rate Optimization.

---

## 2. Métricas y Conceptos Clave
1. **Economía Unitaria Dual:**
   - `$/vCore-mes`: Gasto total de cómputo dividido entre la cantidad de vCores activos.
   - `$/GiB RAM-mes`: Gasto total de cómputo dividido entre los GiB de memoria RAM aprovisionados.
   - `Costo por vCore Efectivo Usado`: `costPerCore / (avgCpuUtilization / 100)`. Refleja el costo real por la capacidad de cómputo que efectivamente trabaja.

2. **Mix de Compra y Compromisos:**
   - Desglose entre PAYG, Spot y Azure Hybrid Benefit (AHUB).
   - Porcentaje de cobertura de compromisos (Reserved Instances y Savings Plans).

3. **Arquitectura y Generaciones:**
   - Distribución de vCores y costo unitario por arquitectura de procesador: ARM (Ampere Altra), AMD (EPYC), Intel (Xeon).
   - Distribución por generación de VM (v3, v4, v5, v6).

4. **Desglose Multi-Dimensional:**
   - Desglose por Región con comparativa porcentual vs. la región más económica.
   - Desglose por Suscripción con resolución de nombres mediante `azureSubscriptionNames.ts`.
   - Desglose por SKU con memoria RAM, tipo de compra, costo total y acciones sugeridas.

---

## 3. Entradas, Fuentes y Agregación
1. **CostMeterSnapshots (Primario) / CostSnapshots (Fallback):**
   - Agrupación por SKU (`MeterSubCategory`), cores (`MeterName`), región (`resource_location`), suscripción (`subscription_id`) y fecha.
   - Idempotencia y exclusión de identificadores no atribuibles (`mg-aggregated`, `default`) para evitar suscripciones ficticias.

2. **Azure Monitor API:**
   - Métrica de utilización de CPU (`Percentage CPU`) sobre las VMs del inventario para calcular la utilización promedio ponderada.

3. **Rate Optimization Engine:**
   - Detección de oportunidades de Savings Plans (cobertura base), migración a arquitectura ARM (v8/v6), activación de Azure Hybrid Benefit (AHUB) en VMs con Windows Server detectado, y arbitraje de región hacia zonas más económicas.

---

## 4. Estándares de Diseño y Experiencia de Usuario
- Gráfica de tendencia con `ResponsiveContainer`, `AreaChart` con gradiente `#0054A6` y `ReferenceLine` para el benchmark de mercado.
- Gráfica de barras horizontales para el mix de arquitectura con código de colores oficial (`#0054A6` Intel, `#00AEEF` AMD, `#10B981` ARM).
- Barras de progreso para el mix de generaciones.
- Tablas completas y responsive con popovers explicativos `#1B2A41` en cada KPI y encabezado de sección.
- Paridad estricta i18n en `messages/es.json`, `messages/en.json`, `messages/pt-BR.json`.
