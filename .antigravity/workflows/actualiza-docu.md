---
name: actualiza-documentacion
trigger: /actualiza-docu
description: Sincroniza y actualiza la documentación técnica (HLD, LLD), manuales operativos, README.md y exportables PDF.
inputs:
  - scope: string
    description: Módulos o cambios específicos a priorizar en la actualización documental
    default: "all"
---

## Objetivo del Workflow
Auditar los cambios recientes en el código base y actualizar exhaustivamente la documentación técnica y de usuario del sistema FinOps SaaS.

## Secuencia de Ejecución

**Paso 1: Auditoría de Cambios y Tipado**
1. Inspeccionar las rutas `src/app/`, `src/components/`, `src/services/` y `src/types/`.
2. Identificar nuevos endpoints, esquemas de bases de datos y contratos de interfaz TypeScript.

**Paso 2: Actualización de HLD y LLD**
1. Editar `docs/architecture/HLD.md`: reflejar topología, seguridad multi-tenant y flujos de integración.
2. Editar `docs/architecture/LLD.md`: documentar tipos, servicios backend, consultas ARG KQL y lógica de persistencia.

**Paso 3: Actualización de Manuales Operativos**
1. Actualizar `docs/manuals/manual-usuario.md` con guías paso a paso de los módulos de Gobernanza, Limpieza y Analítica.
2. Actualizar `docs/manuals/manual-superadmin.md` con las instrucciones de triaje de tickets globales, configuración SAML y delegaciones Lighthouse.

**Paso 4: Sincronización de README.md y Compilación PDF**
1. Actualizar `README.md` en la raíz con el estado actual del repositorio, stack tecnológico y nuevas variables.
2. Ejecutar la tarea de generación de PDF para exportar copias actualizadas en `docs/pdf/`.

**Paso 5: Resumen de Entrega**
1. Presentar un listado de los archivos modificados con una síntesis de las secciones añadidas.