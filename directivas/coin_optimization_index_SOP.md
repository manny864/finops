# Procedimiento Operativo Estándar (SOP): Índice de Optimización COIN (Cost Optimization Implementation Number)

## 1. Objetivo
Refactorizar y enriquecer la vista y servicio del **Índice de Optimización (COIN)** en la plataforma SaaS FinOps (Next.js App Router, TypeScript, Tailwind CSS, MySQL) para proveer visibilidad dual de ejecución (volumen de recomendaciones vs. valor monetario capturado), conciliación exacta de los 5 estados de recomendaciones, desglose de los 5 pilares Well-Architected Framework (WAF), serie temporal histórica y lista interactiva de Quick Wins pendientes.

---

## 2. Entradas y Parámetros
- `tenantId` (string, obligatorio): Identificador del tenant.
- `days` (number, opcional, default: 90): Ventana de evaluación histórica.
- Token de autenticación Bearer con validación RBAC (Tier mínimo: Professional).

---

## 3. Lógica de Negocio y Fórmulas
1. **Conciliación Exhaustiva de Estados (Total $N = 75$ en demo / real en prod):**
   - `pending` (o `open`): Recomendaciones abiertas sin acción aún.
   - `accepted` (o `inProgress`): Aceptadas/planeadas para ejecución técnica.
   - `implemented`: Acciones ejecutadas y confirmadas con éxito.
   - `snoozed` (o `suppressed`): Pospuestas temporalmente con fecha de expiración (`expires_at`).
   - `dismissed`: Descartadas formalmente con justificación documentada.
   - **Regla de integridad:** `total = pending + accepted + implemented + snoozed + dismissed`.

2. **Cálculo COIN Dual:**
   - **COIN por Volumen (`coinVolumeRate`):**
     $$\text{coinVolumeRate} = \left(\frac{\text{implementedCount}}{\text{totalCount}}\right) \times 100$$
   - **COIN Financiero (`coinFinancialRate`):**
     $$\text{coinFinancialRate} = \left(\frac{\text{realizedSavings}}{\text{totalPotentialSavings}}\right) \times 100$$
   - `totalPotentialSavings`: Ahorro mensual consolidado de todas las recomendaciones (abiertas + aceptadas + implementadas).
   - `realizedSavings`: Ahorro mensual capturado exclusivamente de las recomendaciones `implemented`.

3. **Categorías Well-Architected Framework (WAF):**
   - 5 pilares oficiales:
     - `Cost` (Optimización de Costos)
     - `Security` (Seguridad y Cumplimiento)
     - `Reliability` / `HighAvailability` (Confiabilidad y Alta Disponibilidad)
     - `Performance` (Rendimiento)
     - `OperationalExcellence` (Excelencia Operativa)
   - Cada categoría reporta: `implemented`, `total`, `coinRate` (%), `potentialSavingsUsd`, `realizedSavingsUsd`.

4. **Tendencia Mensual Histórica:**
   - Serie temporal de los últimos 6 meses con `month` (`YYYY-MM`), `coinRate`, `implementedCount`, `totalCount`.
   - Línea de Benchmark / Meta objetivo: 70% de implementación.

5. **Top Quick Wins Pendientes:**
   - Lista priorizada de las 5 recomendaciones abiertas con mayor ahorro potencial mensual o impacto técnico.
   - Columnas requeridas: Recomendación, Categoría, Recurso Afectado, Ahorro Mensual Estimado, Botón de acción directo / Resolver.

---

## 4. Requerimientos de UI y Estándar Corporativo
- **Colores Corporativos:** Azul profundo `#1B2A41` (títulos, cards, tooltips), Azul acción `#0054A6`, Cyan `#00AEEF`, Verde `#10B981`, Ámbar `#F59E0B`, Rojo `#EF4444`.
- **Tipografías:** Montserrat para títulos (`#1B2A41`), Sans-serif para métricas y tablas.
- **Iconografía:** Tabler Icons (`@tabler/icons-react`).
- **Botones Corporativos:** Fondo blanco puro, borde con color coincidente con el texto.
- **Tooltips e InfoPopovers:** Componente `InfoTooltip` con fondo `#1B2A41` y capa `z-[9999]`.
- **Modales y Drawers:** `fixed inset-0 bg-black/50 z-50` y contenedor en `z-50` o superior (`z-[100]`).
- **Aislamiento de Mocks:** Solo cuando `isMockTenant(tenantId)` es verdadero; en producción consultar Azure Advisor / `RecommendationActions`.
- **Margen de Gráficos:** `margin={{ left: 50, right: 30 }}` en gráficos horizontales de Recharts para que `Operational Excellence` no se trunque jamás.

---

## 5. Casos Borde y Gotchas Conocidos
- En Recharts horizontal, `YAxis` necesita `width={150}` o margen izquierdo amplio para textos largos como "Operational Excellence".
- En caso de división por cero (`totalCount === 0` o `totalPotentialSavings === 0`), retornar tasa 0% sin romper `NaN` o `Infinity`.
- Todas las traducciones deben estar sincronizadas en `messages/es.json`, `messages/en.json` y `messages/pt-BR.json`.
