# Directiva: Actualización Obligatoria de Documentación Técnica

## Objetivo
Asegurar que la documentación técnica (LLD, manuales de usuario, README) se mantenga **sincronizada** con el código fuente en todo momento. Ninguna implementación o cambio que afecte la arquitectura, APIs, modelo de datos, UI, infra o seguridad puede mergearse sin actualizar los documentos impactados.

## Alcance

Esta directiva aplica a **todo cambio** que modifique alguno de estos dominios:

| Dominio | Documentos a actualizar |
|---|---|
| Arquitectura / Infraestructura | `docs/lld/00-lld-completo.md`, `docs/lld/LLD-FinOps-CSCloudSolutions.pdf`, `README.md` |
| Rutas API (crear/eliminar/cambiar guard/tier) | `docs/lld/00-lld-completo.md` (§6 Servicios, §5 Seguridad), `docs/lld/generated/api-inventory.md` |
| Modelo de datos (tablas/columnas/migraciones) | `docs/lld/00-lld-completo.md` (§4 Modelo de Datos), `docs/lld/generated/db-tables.md` |
| Páginas de UI (crear/eliminar/cambiar tier) | `docs/lld/00-lld-completo.md` (§10 UI), `docs/lld/generated/ui-routes.md` |
| Variables de entorno (nuevas/eliminadas) | `docs/lld/00-lld-completo.md` (§15 Env Vars), `docs/lld/generated/env-vars.md`, `.env.example` |
| Servicios / Modules (crear/eliminar) | `docs/lld/00-lld-completo.md` (§6 Servicios), `docs/lld/generated/code-inventory.md` |
| Seguridad / RBAC / Tiers | `docs/lld/00-lld-completo.md` (§5 Seguridad) |
| Cron Jobs (crear/eliminar/cambiar frecuencia) | `docs/lld/00-lld-completo.md` (§5.3 Cron Jobs), `README.md` |
| CI/CD / Workflows / Docker | `docs/lld/00-lld-completo.md` (§7 Pipeline), `README.md` |
| Terraform (módulos/recursos/variables) | `docs/lld/00-lld-completo.md` (§11 Infraestructura), `infra/README.md` |
| Integraciones externas | `docs/lld/00-lld-completo.md` (§8 Integraciones) |
| Features visibles al usuario | `MANUAL_DE_USUARIO.md`, `docs/manual/MANUAL_USUARIO_{ES,EN,PT-BR}.md` |
| Features de SuperAdmin | `docs/manual/MANUAL_SUPERADMIN_{ES,EN,PT-BR}.md` |
| Pendientes / Estado del proyecto | `docs/lld/00-lld-completo.md` (§12 Estado Actual) |

## Procedimiento

### 1. Antes de implementar
- Revisar si el cambio planificado impacta algún dominio de la tabla anterior.
- Si impacta: marcar los documentos a actualizar en el plan de trabajo.

### 2. Durante la implementación
- Actualizar los documentos **en el mismo branch** que el código.
- No dejar la actualización de docs para "después del merge".

### 3. Archivos generados automáticamente
Los 5 archivos en `docs/lld/generated/` se regeneran con:
```bash
node scripts/generate-lld.mjs
```
Ejecutar este comando **después de cada cambio** que afecte APIs, tablas, rutas UI, servicios o env vars.

### 4. PDF del LLD
El PDF se regenera con:
```bash
node scripts/generate-lld-pdf.js
```
Ejecutar **después de cada cambio al markdown** `docs/lld/00-lld-completo.md`. El PDF incluye diagramas Mermaid renderizados como SVG.

### 5. PDFs de manuales de usuario
Los PDFs de manuales se regeneran con:
```bash
node scripts/generate-manual-pdfs.js
```
Ejecutar después de modificar cualquier manual en `docs/manual/`.

### 6. README.md
- Es la cara del repositorio en GitHub.
- Actualizar siempre que cambien: capabilities, env vars, setup, infra, workflows, cron jobs, o la estructura del proyecto.
- Mantener sincronizado el diagrama Mermaid y el árbol de directorios.

## Checklist de commit (extendido)

Agregar a la checklist existente del `AGENTS.md`:

- [ ] ¿Mi cambio impacta arquitectura/APIs/DB/UI/infra/seguridad?
  - [ ] ¿Actualicé `docs/lld/00-lld-completo.md`?
  - [ ] ¿Regeneré `docs/lld/generated/*` si aplica?
  - [ ] ¿Regeneré el PDF del LLD?
- [ ] ¿Mi cambio afecta features visibles al usuario?
  - [ ] ¿Actualicé los manuales (ES/EN/PT-BR)?
  - [ ] ¿Regeneré los PDFs de manuales?
- [ ] ¿Mi cambio afecta capabilities, setup, o infra pública?
  - [ ] ¿Actualicé `README.md`?

## Restricciones

1. **No se acepta un PR que agregue/elimine un endpoint API sin actualizar el LLD.**
2. **No se acepta un PR que agregue/elimine una tabla/migración sin actualizar el LLD.**
3. **No se acepta un PR que cambie la UI (páginas/tiers) sin actualizar el LLD.**
4. **No se acepta un PR que agregue features de usuario sin actualizar los manuales.**
5. **El PDF del LLD debe estar al día con el .md en cada merge a `main`.**

## Caso borde: Cambios triviales

Si el cambio es puramente interno (refactor sin cambio de contrato, fix de bug sin cambio de API, ajuste de estilo) y no altera nada de lo listado en la tabla de dominios, la actualización de docs **no es necesaria**.

## Nota para el agente

Esta directiva **tiene prioridad** sobre la velocidad de implementación. Un cambio implementado sin documentación actualizada es un cambio incompleto. El ciclo es:

```
Código + Docs + Tests = Implementación completa
```

Aprendido: en sesiones anteriores se acumuló deuda de documentación que requirió un relevamiento completo (LLD) para ponerse al día. Esta directiva existe para **que eso no vuelva a pasar**.
