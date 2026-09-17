# Runbook — pasos manuales antes del deploy de los fixes de 429

Estado al 2026-09-16. Son los tres pasos que **no** se pueden automatizar desde
el repo y hay que ejecutar a mano, en este orden.

Al final hay una sección de verificación para confirmar que los 429
efectivamente bajaron.

---

## Por qué está escrito esto y no ejecutado

Se intentó ejecutarlo desde la máquina de desarrollo y ninguno de los tres pasos
es posible desde ahí:

| Paso | Bloqueo |
| --- | --- |
| 1. `web_max_replicas` | El valor vive en el secret `TF_VARS_PROD` de GitHub. Los secrets son **write-only**: la API no permite leer el valor actual, así que no se puede editar quirúrgicamente sin tener el contenido completo a mano. Tampoco hay `gh` CLI instalado. |
| 2. `terraform apply` | El stamp vive en la suscripción `ec03e8ce…` (tenant `81ebe027…`, CSCS). La sesión de `az` de esa máquina está logueada como usuario de **BCBA** (`99d6b2c5…`) y no ve esa suscripción. |
| 3. Rol en el MG | La sesión de `az` sí está en el tenant correcto (`99d6b2c5…`), pero el token tiene el **MFA vencido** (`AADSTS50078`) y renovarlo exige login interactivo. |

---

## Paso 1 — `web_max_replicas = 3` en el secret `TF_VARS_PROD`

**Los crons ya NO hay que tocarlos.** Se movieron a
`infra/terraform/environments/prod/cron-jobs.tfvars`, que está versionado en git
y el workflow pasa como segundo `-var-file`, con lo cual pisa cualquier
`cron_jobs` que haya quedado en el secret. Si el secret todavía tiene un bloque
`cron_jobs`, es inofensivo: queda muerto. Se puede borrar por prolijidad.

Lo único que queda en el secret es `web_max_replicas`, porque está **anidado**
dentro de la variable `stamps` y el override de Terraform es por variable
entera, no por clave.

1. Ir a **Settings → Secrets and variables → Actions → `TF_VARS_PROD`**.
2. Pegar el contenido actual (hay que tenerlo guardado; GitHub no lo muestra).
3. Dentro del bloque `stamps.us`, buscar la línea:

   ```hcl
   web_max_replicas = 5
   ```

   y **borrarla**, o dejarla en `3`. Borrarla es preferible: el default
   committeado en `variables.tf` ya es `3`, así que el valor pasa a gestionarse
   desde git como el resto.

4. Guardar.

> **No subirlo de 3.** El limitador de concurrencia contra Cost Management
> (`COST_MAX_CONCURRENT = 2` en `billingHelpers.ts`) es estado de módulo: vive
> **por proceso**, no por servicio. Cada réplica extra multiplica la
> concurrencia real contra una API que ya throttlea con 2, así que escalar
> horizontalmente **empeora** los 429 en vez de aliviarlos. La medición de 24 h
> en prod además nunca pasó de 1 réplica (CPU 5-15 %).
> `checks.tf` emite un warning en el plan si algún stamp queda por encima de 3.

---

## Paso 2 — `terraform apply`

El módulo queda en `revision_mode = "Single"`: cada deploy actualiza producción
directamente. Hacerlo en ventana tranquila si el plan muestra cambios de ingress.

Se dispara con el workflow `terraform.yml` (`workflow_dispatch`), escribiendo
exactamente `APPLY-PROD` en el input `confirm`.

Si se corre a mano en local, **los dos `-var-file`, siempre, y en este orden**:

```bash
cd infra/terraform/environments/prod
terraform plan -var-file=terraform.tfvars -var-file=cron-jobs.tfvars -out tfplan
terraform apply tfplan
```

Omitir el segundo `-var-file` planifica los crons viejos del secret.

### Qué mirar en el plan antes de aprobar

- El `azurerm_container_app` del web puede actualizarse.
- Los `azurerm_container_app_job` cambian de horario: son los crons repartidos.
- No debería haber ningún `destroy` de MySQL, Key Vault ni Storage. Si aparece
  alguno, **frenar**.
- Pueden aparecer warnings de los `check` blocks de `checks.tf`. Son
  informativos y no bloquean; si salta el de `web_max_replicas` significa que el
  paso 1 no se hizo.

---

## Paso 3 — `Cost Management Reader` sobre el management group raíz

Este es el que más impacto tiene sobre los 429 y el único que hay que repetir
**por cada tenant cliente**.

Hoy falla en el tenant `99d6b2c5-1dda-4246-b042-ef21eb53f345` (BCBA), que es el
que aparece en los logs de producción.

Con el rol, el costo de **todas** las suscripciones sale en **una** consulta a
Cost Management. Sin él, la plataforma degrada a una consulta **por
suscripción** — BCBA tiene 6 — y Azure responde 429.

### Quién lo tiene que ejecutar

Alguien con **Owner** o **User Access Administrator** sobre el management group
raíz del tenant cliente. No alcanza con ser Owner de las suscripciones: el MG es
un scope por encima.

### Comandos

```powershell
# 1. Loguearse en el tenant del cliente (con MFA fresco)
az login --tenant 99d6b2c5-1dda-4246-b042-ef21eb53f345

# 2. Obtener el Object ID del SP de la plataforma EN ESE TENANT.
#    Ojo: es el objectId del service principal, NO el appId, y es distinto en
#    cada tenant aunque el appId sea el mismo.
$appId = "<appId de la App Registration de CSCS FinOps>"
$spId = az ad sp show --id $appId --query id -o tsv

# 3. Asignar el rol en el MG raíz
az role assignment create `
  --assignee-object-id $spId `
  --assignee-principal-type ServicePrincipal `
  --role "Cost Management Reader" `
  --scope "/providers/Microsoft.Management/managementGroups/99d6b2c5-1dda-4246-b042-ef21eb53f345"
```

Equivalente en PowerShell con el módulo `Az`:

```powershell
New-AzRoleAssignment -ObjectId $spId `
  -RoleDefinitionName "Cost Management Reader" `
  -Scope "/providers/Microsoft.Management/managementGroups/99d6b2c5-1dda-4246-b042-ef21eb53f345"
```

### Verificar que quedó

```powershell
az role assignment list `
  --scope "/providers/Microsoft.Management/managementGroups/99d6b2c5-1dda-4246-b042-ef21eb53f345" `
  --assignee $spId -o table
```

O desde la propia plataforma, que ya lo reporta:
`GET /api/admin/check-sp-roles` → `summary.managementGroupCostAccess.status`
debe dar `OK`. Si da `MISSING`, el `hint` trae el comando de remediación.

### Si el tenant está delegado por Lighthouse

No hace falta y no va a funcionar: con Lighthouse el MG del cliente nunca es
consultable por el SP del proveedor. La plataforma lo detecta
(`esTenantLighthouseConocido()` en `billingHelpers.ts`) y va directo al fallback
por suscripción **sin gastar reintentos**, que es lo que importa para los 429.

### Para los tenants nuevos

Ya está contemplado: el script de onboarding lo asigna en el paso 4 y, si falla,
ahora lo dice fuerte (antes se lo tragaba en silencio, que es exactamente por
qué BCBA quedó sin el permiso). El resumen final del script lista el `[FAIL]`
con el comando de remediación.

---

## Verificación posterior

Una vez hechos los tres pasos y desplegada la revisión nueva:

1. **Que la revisión nueva esté sirviendo.** El deploy actualiza producción
   directamente y luego corre health check.

2. **En el stream log, que no aparezca más esto:**

   ```
   [BillingService] 429 on forecast(sub …). Pausing global queue & retrying …
   ```

   Algún 429 aislado es normal y está bien: el retry con backoff lo absorbe. Lo
   que no debe volver a verse es la cadena
   `429 → retry → retry → retry → UND_ERR_HEADERS_TIMEOUT → aborted`.

3. **Que el MG deje de reintentarse.** Antes se veía el mismo scope fallando
   cada pocos minutos (19:20, 19:24, 19:26). Con el fix de
   `isStructuralScopeFailure()` el scope se marca inutilizable por 6 h al primer
   fallo de autorización, así que a lo sumo debería aparecer una vez cada 6 h —
   y si se hizo el paso 3, ninguna.

4. **Que los prewarm ya no arranquen juntos.** En el log, los `[prewarm-*]`
   tienen que estar repartidos por minuto, no todos en `:00`.

Si después de esto siguen apareciendo 429 sostenidos, el siguiente paso es el
que recomendó Microsoft: dejar de consultar la Query API online y pasar a **Cost
Management Exports** → Storage → ETL → MySQL, con el dashboard leyendo de MySQL.
Los fixes de esta tanda bajan mucho el volumen, pero no cambian el modelo de
"consultar Azure en vivo".
