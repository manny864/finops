# Directiva: Progreso Histórico y Retorno de Inversión FinOps (SOP)

## Objetivo
Implementar el módulo integral de **Progreso Histórico (Historical Progress)** en `/overview/progress`, permitiendo a los directores ejecutivos y equipos de ingeniería visualizar la evolución temporal de la madurez FinOps, ahorro contrafactual, higiene de tags, salud de compromisos (RIs/SPs), cacería zombi, precisión del forecast ML, auditoría Before vs After y registro de excepciones (Waiver Ledger), soportando rangos temporales de **30 días, 3 meses, 6 meses y 1 año**.

## Arquitectura del Módulo
1. **Selector de Rango Temporal**:
   - `30d` (30 Días - Vista diaria).
   - `90d` (3 Meses - Vista diaria/semanal).
   - `180d` (6 Meses - Vista semanal).
   - `365d` (1 Año - Vista mensual).

2. **Estructura de Vistas (Tabs)**:
   - **Tab 1: Madurez & Gobernanza**:
     - Score de Madurez FinOps (0-100) con desglose por pilares (Asignación, Tarifas, Uso, Gobernanza) e insignias Crawl/Walk/Run.
     - Higiene de Tags (% Cobertura) y Reducción de Gasto Huérfano (Unallocated Spend Area Chart).
     - Efectividad de Herencia de Tags (Tag Inheritance).
   - **Tab 2: Compromisos & Desperdicio**:
     - Cobertura y Utilización de Reservas & Savings Plans (% Coverage & % Utilization).
     - Adopción de Azure Hybrid Benefit (AHUB vCores Windows / SQL).
     - Caza de Recursos Zombi (Discos, IPs, Snapshots, PaaS purgados) y Ahorro Recurrente Acumulado.
     - Burndown de Deuda Técnica Financiera (Backlog de Oportunidades vs Ritmo de Resolución y MTTR).
   - **Tab 3: ROI & Ahorro Contrafactual**:
     - Gasto Real vs Línea Base Contrafactual ("Lo que habrías gastado") con Área de Ahorro Neto.
     - Gasto Real vs Presupuesto vs Forecast ML (Holt-Winters / Ensemble) + Detección de Anomalías.
     - Ahorro Realizado vs Fuga por Dilación (Leakage) + Tiempo Promedio de Implementación.
     - Sostenibilidad & GreenOps (MTCO2e emitidas y evitadas).
   - **Tab 4: Before/After & Hitos**:
     - Verificación Antes vs Después (30d antes vs 30d después) con Detección de Efecto Rebote.
     - Marcadores de Hitos de Arquitectura (Releases, Migraciones SQL, Nuevas Regiones).
     - Registro de Excepciones y Rechazos (Waiver Ledger con justificación y fecha de vencimiento).
     - Registro de Auditoría de Acciones (Usuario, método y estado actual del recurso).

## Restricciones y Reglas
- **Precisión Matemática**: Cálculos monetarios exactos, sin pérdida de precisión.
- **Internacionalización (i18n)**: Paridad estricta en las 3 bases de idiomas (`messages/es.json`, `messages/en.json`, `messages/pt-BR.json`).
- **Mocks por Tier**: Soporte completo para tiers Professional (30d/90d), Business (180d) y Enterprise (365d) en `src/lib/mockData.ts`.
- **Eficacia Visual**: Gráficos responsivos de Recharts, paleta corporativa `brand-deep` (`#0054A6`), bordes sutiles y tooltips enriquecidos.
- **Cumplimiento de Estándar de Tablas**: Reutilización de filtros, paginación y ordenamiento en las tablas de auditoría Before/After y Waiver Ledger.