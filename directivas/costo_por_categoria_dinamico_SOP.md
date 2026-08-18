# SOP: Monitor Dinámico y Resolutivo de Costo por Categoría FinOps (FOCUS)

## 1. Contexto y Objetivos
Transformar la sub-pestaña **"Por Categoría"** (`/intelligence/cost-by-category` y dentro de `/intelligence/consumo-y-presupuesto`) de un gráfico estático en un **panel analítico jerárquico y resolutivo de control presupuestario por pilar FinOps**.

### Objetivos Clave:
1. **Clasificación FOCUS / FinOps Toolkit:** Agrupación estandarizada por `ServiceCategory` (Databases, Compute, Networking, Storage, AI and Machine Learning, Security, Management and Governance, Analytics, Web, Other).
2. **Desglose Multinivel (1-Click Drill-Down):** `Categoría` -> `Servicios Subyacentes` -> `Instancias / Recursos individuales` (SKUs, Región, Resource Group, Costo).
3. **Evolución Temporal Apilada (Stacked Area Chart 6M):** Tendencia histórica mensual de distribución del gasto por categoría.
4. **Control Presupuestario por Categoría:** Seguimiento de presupuesto asignado vs ejecutado por pilar con alertas semafóricas.
5. **Variación MoM y Velocidad de Gasto:** Variación porcentual mes a mes y Daily Burn Rate ($/día).
6. **Oportunidades de Remediación Resolutivas:** Acciones directas por categoría dominante (Reserved Capacity en DBs, Egress/NAT en Networking, Rightsizing & Scale-to-Zero en Compute).
7. **Aislamiento Estricto de Mocks:** Mocks calibrados **únicamente** para `isMockTenant(tenantId)`. Los tenants reales consultan Cost Management en vivo y `CostSnapshots` / `CostCategorySnapshots`.
8. **Popovers y Tooltips no bloqueados:** Uso estricto de `InfoTooltip` con React Portal a `document.body` y posicionamiento `fixed` dinámico.

---

## 2. Fórmulas Matemáticas y Reglas de Negocio
- **Share of Wallet (% sobre Total):**
  $$\text{Share} = \left(\frac{\text{Costo Categoría MTD}}{\text{Costo Total MTD}}\right) \times 100$$
- **Daily Burn Rate ($/día):**
  $$\text{Burn Rate} = \frac{\text{Costo Categoría MTD}}{\text{Días Transcurridos del Mes}}$$
- **Proyección a Fin de Mes (Run Rate):**
  $$\text{Proyección} = \text{Burn Rate} \times \text{Días Totales del Mes}$$
- **Variación Mensual (MoM %):**
  $$\Delta\% = \left(\frac{\text{Costo Mes Actual} - \text{Costo Mes Anterior}}{\text{Costo Mes Anterior}}\right) \times 100$$
- **Detección de Spike / Anomalía:**
  $$\text{hasSpike} = \text{true} \quad \text{si } \Delta\% > 15\% \text{ y Costo} > \$10$$

---

## 3. Matriz de Remediación por Categoría Dominante
| Categoría | Gotcha Común / Desviación | Acción Resolutiva Sugerida | Ahorro Est. |
|---|---|---|---|
| **Databases** | Servidores MySQL/PostgreSQL/Redis aprovisionados 24/7 sin reserva ni escalado | `[Ver Recomendaciones DB ✨]` (Reserved Capacity 1y / Downgrade SKU) | 25% - 40% |
| **Networking** | Egress elevado, Gateways NAT subutilizados, IPs públicas huérfanas | `[Auditar Flujos y NAT/IPs ✨]` | 20% - 50% |
| **Compute** | VMs de tamaño excesivo y Container Apps con réplicas fijas sin tráfico | `[Rightsizing de VMs/Containers ✨]` (Scale-to-Zero / B-series) | 30% - 45% |
| **AI & ML** | Inferencia sin cuotas de tokens diarias o modelos sobredimensionados | `[Configurar Cuotas de Inferencia ✨]` | 20% - 40% |
| **Storage** | Blobs en Hot sin lifecycle policy a Cool/Archive | `[Activar Lifecycle Management ✨]` | 15% - 30% |

---

## 4. Checklist de Validación
- [ ] Mocks sólo en `isMockTenant` y aislados del flujo de producción.
- [ ] Los popovers y tooltips flotan sobre `document.body` (`z-index: 999999`) sin recortarse por `overflow: hidden`.
- [ ] Tabla del Drawer con búsqueda, filtros, ordenación y exportación CSV.
- [ ] Internacionalización en `es.json`, `en.json` y `pt-BR.json`.
- [ ] Typecheck y tests en verde (0 errores).
