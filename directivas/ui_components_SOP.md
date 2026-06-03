# Directiva: Generación de Componentes UI para Azure FinOps

## Objetivo
Crear una suite de componentes React modulares, escalables y orientados al rendimiento (Next.js + Tailwind CSS) que correspondan a los requerimientos visuales y de UX de la propuesta de Azure FinOps. 

## Entradas
- Datos crudos desde los endpoints `/api/consumption` y `/api/recommendations` de Azure.

## Salidas
- `src/components/layout/FinOpsDashboardLayout.tsx` (App shell con Grid).
- `src/components/dashboard/QuickWinsTable.tsx` (Tabla optimizada con `content-visibility`).
- `src/components/dashboard/ExecutiveSummaryCard.tsx` (Métricas con Container Queries).
- `src/components/remediation/ApprovalWorkflowBoard.tsx` (Flujo de aprobación).

## Lógica y Pasos
1. Todo componente UI se genera a través del script de Python `generate_ui_components.py` para asegurar determinismo.
2. Utilizar Raw Tailwind CSS. No importar dependencias externas como shadcn a menos que se agreguen al `package.json` explícitamente en el futuro.
3. Se deben aplicar las mejores prácticas modernas de CSS:
   - `grid-template-areas` para el shell principal.
   - `content-visibility: auto` para listas masivas en la tabla de quick wins.
   - `@container` y `cqi` (Container Queries) para las tarjetas ejecutivas.

## Trampas Conocidas / Restricciones
- El SDK de Next.js App Router usa Server Components por defecto; asegurarse de tipar las props explícitamente. Se puede agregar `"use client"` más adelante cuando se conecten Hooks, pero por ahora se definen los layouts puros.
- Los Container Queries requieren el uso explícito de `container-type` en un contenedor padre.
