# SOP — Consumo Real Dinámico, Burn Rate y Detección de Anomalías

## 1. Propósito y Alcance
Transformar la vista de **Consumo Real** (`/intelligence/consumo-y-presupuesto`) de un listado estático de cifras en un monitor ejecutivo de alta resolución para FinOps, que proporcione:
1. **Contexto Financiero Relativo:** % de participación sobre el total (*Share of Wallet*).
2. **Velocidad de Gasto:** *Daily Burn Rate* ($/día) y *Run Rate Proyectado* a fin de mes.
3. **Tendencias y Detección de Anomalías:** Variación MoM (% frente al mes anterior) y alertas de picos (*Spikes*) en las últimas 48h (>30% sobre la media móvil de 14 días).
4. **Desglose en 1-Clic (*Drill-Down Drawer*):** Granularidad FOCUS (BilledCost vs. EffectiveCost) a nivel de recurso individual (SKU, Región, Grupo de Recursos).
5. **Remediaciones Resolutivas Específicas:** Acciones rápidas de optimización por servicio dominante (Redis Cache, Azure Container Apps, Foundry Models, Cognitive Search, Container Registry, Virtual Network / LB).

---

## 2. Métricas Clave y Fórmulas Matemáticas

### A. Participación sobre el Total (Share of Wallet)
$$\text{ShareOfWallet}_i = \left( \frac{\text{Costo MTD del Servicio}_i}{\text{Gasto Total MTD}} \right) \times 100$$
- Visualización: Barra de progreso horizontal en cada tarjeta de servicio y *Stacked Progress Bar* global en el encabezado para el Top 5.

### B. Velocidad de Gasto (Daily Burn Rate)
$$\text{DailyBurnRate}_i = \frac{\text{Costo MTD del Servicio}_i}{\text{Días Transcurridos del Mes en Curso}}$$
- Precisión: Uso de tipos exactos (`Decimal.js`), evitando imprecisiones de coma flotante.

### C. Run Rate Proyectado a Fin de Mes
$$\text{ProjectedCost}_i = \text{DailyBurnRate}_i \times \text{Días Totales del Mes (28-31)}$$

### D. Variación Mes sobre Mes (MoM %)
$$\text{MoM} = \left( \frac{\text{Costo Día } d \text{ Mes Actual} - \text{Costo Día } d \text{ Mes Anterior}}{\text{Costo Día } d \text{ Mes Anterior}} \right) \times 100$$

### E. Detección de Anomalías / Spikes (Últimas 48 Horas)
$$\text{Gasto Diario Reciente (48h)} > 1.30 \times \text{Media Móvil (14 días)}$$
- Asignación de flag `hasAnomaly: true` con badge ámbar destacado en la tarjeta y en el drawer.

---

## 3. Matriz de Remediaciones Resolutivas por Servicio Dominante

| Servicio / Categoría | Condición de Alerta | Acción Resolutiva Sugerida | Ahorro Est. Mensual |
| :--- | :--- | :--- | :--- |
| **Redis Cache** | Mayor costo MTD (>20% total) o tier Standard/Premium en ambientes no-prod | `Evaluar SKU Basic / C1 ✨` | ~$40/mes |
| **Azure Container Apps** | Réplicas mínimas > 1 sin tráfico sostenido 24/7 | `Configurar Scale-to-Zero ✨` | ~$25/mes |
| **Foundry Models / AI** | Inferencia de tokens sin límite de cuota o picos en 48h | `Activar Límite de Cuota ✨` | Variable (~30%) |
| **Azure Cognitive Search** | Tier Standard con bajo volumen de queries/índices | `Revisar Réplicas / Tier ✨` | ~$50/mes |
| **Container Registry (ACR)** | Tier Standard/Premium sin Geo-Replication activa | `Downgrade a Basic ($5/mes) ✨` | ~$15/mes |
| **Virtual Network / LB** | IPs públicas inactivas o Load Balancers sin backends | `Auditar IPs Públicas / NAT ✨` | ~$30/mes |

---

## 4. Estándar Visual y de Interacción (Frontend & UI)

1. **Header Principal de Consumo:**
   - Tarjeta destacada con Gasto Total MTD, Proyección a Fin de Mes, Burn Rate Diario General, Badge MoM y contador de días transcurridos.
   - Barra de distribución global apilada (*Stacked Progress Bar*) con colores corporativos armónicos (`#0054A6`, `#00AEEF`, `#10B981`, `#8B5CF6`, `#F59E0B`, `#64748B`).
2. **Smart Service Cards:**
   - Botones/Cards interactivos con cursor `pointer` y micro-hover suave.
   - Badge MoM dinámico (Verde para reducción, Rojo/Ámbar para incremento).
   - Badge de Anomalía con icono de alerta si `hasAnomaly` es verdadero.
   - Barra de progreso horizontal con el % de peso.
   - Badge de recomendación FinOps contextual.
3. **Drill-down Drawer / Modal:**
   - Despliegue lateral animado al hacer clic en cualquier tarjeta.
   - Tabla de recursos individuales con columnas: Recurso, Grupo de Recursos, Región, SKU, BilledCost (FOCUS), EffectiveCost (FOCUS), Costo MTD y Acción de Optimización.
4. **Botones Corporativos:**
   - Fondo blanco puro (`bg-white dark:bg-slate-900`) con borde y texto coincidente según la Regla #21 de `AGENTS.md`.
5. **Tooltips Informativos:**
   - Componente `InfoTooltip` en títulos, KPIs, tarjetas y cabeceras de tabla conforme a la Regla #22.
6. **Internacionalización (i18n):**
   - Sincronización obligatoria en `messages/es.json`, `messages/en.json` y `messages/pt-BR.json` bajo el namespace `RealConsumptionMonitor`.

---

## 5. Protocolo de Fallback y Resiliencia
1. **Live Azure Cost Management:** Consulta de uso MTD y descomposición por `ServiceName` y `ResourceId`.
2. **Fallback CostSnapshots:** Si Azure API rechaza la llamada o hay límite de rate, consultar agregaciones de la tabla `CostSnapshots`.
3. **Ambiente Mock / Demo:** Cobertura enriquecida por tiers (Professional, Business, Enterprise) en `src/lib/mockData.ts` con los valores calibrados del tenant de demostración.
