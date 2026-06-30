# Tag Inheritance as a Service (Feature C)

## Tier asignado
**Business+** (efectivo, porque la ruta `/governance/tags` ya está gated a Business en `routeTiers.ts`).

## Qué resuelve
El [`tag-inheritance` del finops-toolkit](https://github.com/microsoft/finops-toolkit) es un módulo Bicep que aplica tags del Resource Group a recursos hijos. Requiere despliegue en cada suscripción del cliente.

Acá se ofrece como **servicio gestionado**: sin desplegar nada en Azure, usando el SP del tenant + Resource Graph + ARM Tags API.

## Cómo funciona

1. **Preview** (`GET /api/governance/tags/inheritance-preview`):
   - Recibe `tenantId`, `subscriptionId` (o "All"), `tagKeys` opcional (filtro), `limit`.
   - KQL en Resource Graph: une Resources con ResourceContainers (RGs) por `resourceGroup`.
   - Para cada recurso, calcula tags presentes en el RG y ausentes en el recurso.
   - Devuelve filas con `missingTags`.

2. **Apply** (`POST /api/governance/tags/apply-inheritance`):
   - Body: `{ tenantId, ops: [{resourceId, tagsToMerge}], dryRun? }`.
   - Llama `PATCH /providers/Microsoft.Resources/tags/default` con `operation: Merge`.
   - **Nunca sobrescribe** tags pre-existentes en el recurso.
   - Concurrencia 8, retry exponencial x2 en 429/5xx, batch máx 200 ops.
   - Requiere rol `Admin` u `Owner` en el tenant (RBAC propio del SaaS).

## UI
`src/components/dashboard/TagInheritancePanel.tsx` integrado en `/governance/tags` debajo del TagManager existente. Flujo:
- Input opcional de keys filtradas (`Environment,CostCenter,Owner`).
- Botón "Analizar" → tabla con checkboxes (todas seleccionadas por default).
- Botones "Dry-run" y "Aplicar a Azure" con conteo de éxito/fallo.

## Files
- `src/services/tagInheritanceService.ts` — `analyzeMissingTags`, `applyTagInheritance`.
- `src/app/api/governance/tags/inheritance-preview/route.ts` — GET, requiere `requireTenantAccess`.
- `src/app/api/governance/tags/apply-inheritance/route.ts` — POST, requiere `requireTenantRole(['Admin','Owner'])`.
- `src/components/dashboard/TagInheritancePanel.tsx` — UI.

## Seguridad
- **Mutación protegida**: rol Admin/Owner en `Users.role`, validado por `requireTenantRole`.
- **No floats**: no aplica (sólo strings).
- **Merge-only**: el ARM API call usa `operation: Merge` — no se llama nunca con `Replace`.
- **Batch cap**: máximo 200 ops por request para evitar abuso o timeouts largos.

## Permisos Azure necesarios
El SP del tenant debe tener al menos `Tag Contributor` (o `Contributor`) sobre las suscripciones objetivo. Si solo tiene `Reader` el preview funciona pero el apply devolverá 403 por recurso.

## Smoke test
```
curl -i "http://localhost:3000/api/governance/tags/inheritance-preview?tenantId=xxx"  → 401 sin token
curl -i -X POST -d '{}' "http://localhost:3000/api/governance/tags/apply-inheritance"  → 400 sin body válido
```

## Próximas mejoras (no incluidas)
- Scheduling automático (cron weekly) por tenant.
- Métricas: % compliance histórico en `TagComplianceHistory`.
- Whitelisting de recursos (tag `excluded-from-inheritance=true`).
