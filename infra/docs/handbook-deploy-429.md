# Handbook — puesta en producción de los fixes de 429

Estado: **el código ya está en `main` en GitHub.** Lo que queda son pasos
manuales que no puede hacer ningún workflow, más la promoción del tráfico.

Pensado para ejecutarse desde otra máquina/IDE, de principio a fin y en orden.
Cada paso dice **quién** lo puede hacer, **qué** verifica y **qué hacer si
falla**.

Tiempo estimado: 40-60 min, casi todo esperando al `terraform apply` y al build.

---

## 0. Qué está hecho y qué no

Commits ya en `origin/main`:

| Commit | Contenido |
| --- | --- |
| `f62d2288` | `fix(billing)` — caché de forecast/historical, pausa por Redis, fix de `isStructuralScopeFailure`, caché de suscripciones, timeout en prewarm |
| `a2a594c4` | `feat(infra)` — `cron-jobs.tfvars` versionado, `checks.tf`, `web_max_replicas = 3` |
| `b20c0bf9` | `feat(onboarding)` — rol de Cost Management Reader sobre el MG, visible cuando falla |
| `fc5c5938` | `docs(infra)` — runbook de pasos manuales |

**El deploy ahora es directo.** `deploy-azure.yml` construye la imagen, corre
migraciones, actualiza la app, actualiza los cron jobs y hace health check de
producción.

Checklist de lo que falta:

- [ ] 1. Sacar `web_max_replicas` del secret `TF_VARS_PROD`
- [ ] 2. `terraform apply` (recrea el ingress)
- [ ] 3. Rol `Cost Management Reader` sobre el MG de cada tenant cliente
- [ ] 4. Ejecutar/verificar `deploy-azure.yml`
- [ ] 5. Verificar que los 429 bajaron

---

## 1. Secret `TF_VARS_PROD`

**Quién:** alguien con acceso a *Settings* del repo.
**Dónde:** Settings → Secrets and variables → Actions → `TF_VARS_PROD`.

Los secrets de GitHub son write-only: no se puede ver el valor actual, hay que
pegar el contenido completo de nuevo. Se necesita la copia del `terraform.tfvars`
real (la que tenga quien administra la infra).

Dentro del bloque `stamps.us`, buscar:

```hcl
web_max_replicas = 5
```

y **borrar la línea**. El default committeado en `variables.tf` ya es `3`, así
que pasa a gestionarse desde git como el resto. Dejarla en `3` también sirve,
pero es una copia más que puede volver a derivar.

**Los crons ya no hay que tocarlos.** Se movieron a
`infra/terraform/environments/prod/cron-jobs.tfvars`, versionado, que el
workflow pasa como segundo `-var-file`. Terraform resuelve los `-var-file` en
orden y gana el último, así que pisa lo que quede en el secret. Si el secret
todavía trae un bloque `cron_jobs`, queda muerto; se puede borrar por prolijidad.

**Por qué no subir de 3:** el limitador contra Cost Management
(`COST_MAX_CONCURRENT = 2` en `billingHelpers.ts`) es estado de módulo, o sea
**por proceso**. Cada réplica extra multiplica la concurrencia real contra una
API que ya throttlea, así que escalar horizontalmente *empeora* los 429. La
medición de 24 h en prod además nunca pasó de 1 réplica (CPU 5-15 %).

---

## 2. `terraform apply`

**Quién:** el service principal `cscs-finops-terraform` vía workflow, o alguien
con Owner sobre la suscripción `ec03e8ce-ceee-4638-b303-64ae431d5b1e`
(tenant `81ebe027…`, CSCS).

> ⚠️ Si el plan muestra cambios de ingress, hacerlo en ventana tranquila.

### Opción A — por workflow (recomendado)

Actions → **Terraform** → *Run workflow*:

- `environment`: `prod`
- `confirm`: `APPLY-PROD` (exacto, si no solo hace plan)

Conviene correrlo **primero sin** `confirm` para leer el plan, y recién después
con la confirmación.

### Opción B — local

```bash
cd infra/terraform/environments/prod
# terraform.tfvars NO está en el repo: hay que traerlo aparte
terraform init \
  -backend-config="resource_group_name=<rg>" \
  -backend-config="storage_account_name=<sa>" \
  -backend-config="container_name=tfstate" \
  -backend-config="use_azuread_auth=true" \
  -backend-config="key=prod/terraform.tfstate"

terraform plan -var-file=terraform.tfvars -var-file=cron-jobs.tfvars -out tfplan
terraform apply tfplan
```

**Los dos `-var-file`, siempre, y en ese orden.** Omitir el segundo planifica
los crons viejos del secret.

### Qué mirar en el plan antes de aprobar

Esperado:

- `azurerm_container_app` del web: **update** (se recrea el ingress, no el app).
- Varios `azurerm_container_app_job`: cambian los horarios. Son los crons
  repartidos para que no compartan minuto.

**Motivo de frenar:** cualquier `destroy` o `replace` de MySQL, Key Vault,
Storage Account o de la base de datos. Nada de eso debería aparecer.

También pueden salir warnings de los `check` blocks de `checks.tf`. Son
informativos y no bloquean:

- Si salta el de `web_max_replicas`, el paso 1 no se hizo o no se guardó.
- Si salta el de minutos compartidos, alguien editó `cron-jobs.tfvars` rompiendo
  la regla de que los prewarm no comparten minuto.

---

## 3. Rol `Cost Management Reader` sobre el management group

**Quién:** Owner o User Access Administrator **del management group raíz del
tenant cliente**. No alcanza con ser Owner de las suscripciones: el MG es un
scope por encima.

**Hay que repetirlo por cada tenant cliente.** Hoy falla en
`99d6b2c5-1dda-4246-b042-ef21eb53f345` (BCBA), que es el que aparece en los logs.

Con el rol, el costo de **todas** las suscripciones sale en **una** consulta a
Cost Management. Sin él, la plataforma pregunta **por suscripción** — BCBA tiene
6 — y Azure responde 429.

```powershell
# 1. Login en el tenant del cliente, con MFA fresco
az login --tenant 99d6b2c5-1dda-4246-b042-ef21eb53f345

# 2. Object ID del SP de la plataforma EN ESE TENANT.
#    Es el objectId del service principal, NO el appId, y es distinto en cada
#    tenant aunque el appId sea el mismo.
$appId = "<appId de la App Registration de CSCS FinOps>"
$spId = az ad sp show --id $appId --query id -o tsv
$tenant = "99d6b2c5-1dda-4246-b042-ef21eb53f345"

# 3. Asignar
az role assignment create `
  --assignee-object-id $spId `
  --assignee-principal-type ServicePrincipal `
  --role "Cost Management Reader" `
  --scope "/providers/Microsoft.Management/managementGroups/$tenant"
```

Equivalente con el módulo `Az`:

```powershell
New-AzRoleAssignment -ObjectId $spId `
  -RoleDefinitionName "Cost Management Reader" `
  -Scope "/providers/Microsoft.Management/managementGroups/$tenant"
```

### Verificar

```powershell
az role assignment list `
  --scope "/providers/Microsoft.Management/managementGroups/$tenant" `
  --assignee $spId -o table
```

O desde la plataforma, que ya lo reporta:
`GET /api/admin/check-sp-roles` → `summary.managementGroupCostAccess.status`
debe dar `OK`. Si da `MISSING`, el `hint` trae el comando de remediación.

### Casos especiales

- **Tenant delegado por Lighthouse:** no hace falta y no va a funcionar. Con
  Lighthouse el MG del cliente nunca es consultable por el SP del proveedor. La
  plataforma lo detecta (`esTenantLighthouseConocido()`) y va directo al fallback
  por suscripción **sin gastar reintentos**, que es lo que importa para los 429.
- **Tenants nuevos:** ya está contemplado. El script de onboarding lo asigna en
  el paso 4 y, si falla, ahora lo dice fuerte con el comando de remediación
  (antes se lo tragaba en silencio, que es exactamente por qué BCBA quedó sin el
  permiso).

---

## 4. Ejecutar/verificar `deploy-azure.yml`

El deploy actualiza producción directamente.

```bash
az containerapp revision list \
  -n cscs-finops-prod-westus2-web \
  -g cscs-finops-prod-westus2-rg \
  -o table
```

La revisión nueva tiene que estar `Healthy` y la app debe responder `/api/health`.

Qué probar como mínimo: que cargue el dashboard, que el costo MTD muestre datos
y que el histórico no quede vacío.

> ⚠️ **Las migraciones corren antes de actualizar la app.** Toda migración tiene
> que ser compatible hacia atrás.

---

## 5. Verificar que los 429 bajaron

En el stream log del Container App, lo que **no** debería volver a aparecer:

```
[BillingService] 429 on forecast(sub …). Pausing global queue & retrying …
```

Algún 429 aislado es normal y está bien: el retry con backoff lo absorbe. Lo que
no debe repetirse es la cadena completa:

```
429 → retry → retry → retry → UND_ERR_HEADERS_TIMEOUT → aborted
```

Cuatro señales concretas:

1. **El MG deja de reintentarse.** Antes se veía el mismo scope fallando cada
   pocos minutos (19:20, 19:24, 19:26). Con el fix de `isStructuralScopeFailure`
   el scope se marca inutilizable por 6 h al primer fallo de autorización, así
   que a lo sumo aparece una vez cada 6 h — y si se hizo el paso 3, ninguna.
2. **Los prewarm ya no arrancan juntos.** En el log tienen que estar repartidos
   por minuto, no todos en `:00`.
3. **Sin `UND_ERR_HEADERS_TIMEOUT`.** Los prewarm ahora abortan a los 90 s
   (`prewarmFetch`), no a los 300 s del default de undici.
4. **El dashboard responde más rápido** en la segunda carga: forecast e
   historical ahora tienen caché (24 h / 6 h con stale-while-revalidate).

### Si siguen apareciendo 429 sostenidos

El siguiente paso es el que recomendó Microsoft: dejar de consultar la Query API
online y pasar a **Cost Management Exports** → Storage → ETL → MySQL, con el
dashboard leyendo de MySQL. Los fixes de esta tanda bajan mucho el volumen, pero
no cambian el modelo de "consultar Azure en vivo".

---

## Problemas conocidos

**`terraform plan` marca diferencias en todos los cron jobs.**
Falta el segundo `-var-file`. Sin `cron-jobs.tfvars` se planifica contra el
`cron_jobs` viejo del secret.

**El `plan` falla con "no such file: cron-jobs.tfvars".**
El archivo no llegó al checkout. Hay dos `.gitignore` con regla `*.tfvars` (raíz
e `infra/`) y ambos necesitan la excepción `!cron-jobs.tfvars`. Verificar con:

```bash
git check-ignore -v infra/terraform/environments/prod/cron-jobs.tfvars
# exit 1 = no está ignorado = correcto
```

**`az` pide MFA (`AADSTS50078`).**
Token vencido. `az logout` y `az login --tenant <id>` de nuevo.

**El deploy no se disparó con el push.**
`deploy-azure.yml` tiene `paths-ignore` para `infra/**`, `docs/**`, `**.md` y
tests. Un push que toque **solo** esos paths no despliega, a propósito. Se puede
lanzar a mano con *Run workflow*.

---

## Referencias

- `infra/docs/runbook-pre-deploy-429.md` — detalle de los pasos 1-3.
- `infra/docs/deployment-guide.md` — guía general, los dos `-var-file`, y los
  permisos que Terraform no puede dar.
- `infra/terraform/environments/prod/cron-jobs.tfvars` — horarios de cron, con
  la regla de por qué no pueden compartir minuto.
- `infra/terraform/environments/prod/checks.tf` — guardas que avisan en el plan.
