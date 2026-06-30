# SOP: Análisis e Inclusión de Todos los Recursos en la Distribución de Fugas Financieras

## Objetivo
Asegurar que el gráfico circular (Pie Chart) de "Distribución de Fugas Financieras" en el dashboard principal (`src/app/[locale]/page.tsx`) y en el panel interactivo de facturación (`src/components/dashboard/InteractiveDashboard.tsx`) analice e incluya todos los recursos huérfanos auditados que representen una fuga financiera (costo real o estimado mayor a cero), y no se limite únicamente a las máquinas virtuales (VMs).

## Lógica y Pasos
1. **Identificar la causa del filtro de recursos**:
   - Determinar por qué solo se muestran VMs en el dashboard. Analizar si existe un filtro explícito o implícito, o si es un problema de carga/mapeo de datos.
2. **Normalizar la visualización de nombres de recursos**:
   - En `InteractiveDashboard.tsx`, asegurar que el gráfico circular use nombres de categorías legibles y traducidos en lugar de los identificadores camelCase internos o las strings crudas de Azure.
3. **Mapear todos los recursos con costo > 0 en el dashboard**:
   - Asegurar que todos los recursos definidos en `resourceConfig` que tengan `issueType: "cost"` y un costo real o estimado se incluyan en el desglose de fugas.
4. **Verificar consultas de Resource Graph**:
   - Corregir cualquier query de KQL en `kqlCatalog.ts` que pueda estar fallando silenciosamente debido a campos inexistentes (ej. `properties.timeCreated` en recursos de red) lo cual provoca que retornen arreglos vacíos y por ende no se muestren en el gráfico.

## Restricciones y Trampas Conocidas
- Los recursos de gobernanza pura con costo cero no deben aparecer en el gráfico de torta de fugas financieras.
- Los nombres en el gráfico circular del dashboard de billing deben estar unificados con los del dashboard principal para evitar discrepancias visuales.
