# Handoff de Infraestructura — 2026-08-22

Documento autocontenido para retomar el trabajo de infraestructura desde otro IDE, otra
máquina o por otra persona. **No hace falta leer la conversación previa.**

- **Rama:** `staging` (14 commits por delante de `main`, todos pusheados)
- **Último commit:** `58c00f6`
- **Producción:** sana — `finops.cscloudsolutions.com.ar/api/health` → 200, revisión
  `cscs-finops-prod-westus2-web--0000089` Healthy, 15 cron jobs, Container App Environment `Succeeded`
- **Estado del trabajo:** un `terraform apply` sobre prod se ejecutó **parcialmente** y falló en el último
  recurso. Quedan **dos decisiones abiertas** que requieren criterio humano (§6).

---

## 1. Qué pasaba al empezar

Tres problemas encadenados, ninguno visible desde la aplicación:

1. **El workflow de Terraform estaba rojo desde el 2026-08-17.** `terraform validate` fallaba porque
   azurerm 4.x volvió obligatorio `worker_id` en `azurerm_automation_hybrid_runbook_worker`. Nadie pudo
   correr un plan en cinco días, así que la deriva se acumuló sin que se viera.
2. **Un `terraform apply` habría destruido la producción entera.** El plan real daba **22 bajas**: el
   Container App Environment, la app web, el job de migraciones, los 14 cron jobs y el certificado del
   dominio propio.
3. La documentación de infra mandaba a recursos que no existen, y `environments/staging/` nunca había
   pasado `terraform validate` desde que se creó.

---

## 2. Causa raíz del punto 2, que es lo importante

Una sola línea, con efecto cascada:

```
- infrastructure_resource_group_name = "ME_cscs-finops-prod-westus2-cae_..." -> null # forces replacement
```

Azure genera solo ese resource group del entorno y lo devuelve en el state. La configuración no lo declara,
y desde azurerm 4.x el proveedor lee la ausencia como `ForceNew`. Al reemplazarse el CAE cambia su id, y
**todo lo que lo referencia se reemplaza detrás**.

Resuelto con `lifecycle { ignore_changes = [...] }` en `modules/stamp/main.tf`.

**Verificado que no lo introdujo esta sesión:** un plan sobre el código pre-sesión (`e6287ee`) con sólo el
fix de `worker_id` aplicado da los mismos 22 destroys. Estaba latente.

Resultado tras el fix, confirmado en un apply real: el CAE figura como `will be updated in-place`.

---

## 3. Los 14 commits

| Commit | Qué hace |
|---|---|
| `494387c` | Elimina referencias a la suscripción `CSCloudSolution-Production` (`0beb7800`), dada de baja |
| `40ae5c4` | Borra `infra/pipelines/`: plantillas superadas por los workflows vivos, con nombres inexistentes |
| `39b7cb1` | Corrige nombres de recursos, región y marca en la documentación de infra |
| `61d0ef7` | Sincroniza LLD, README y HANDOFF |
| `e2912c7` | Marca: `"CS CLOUD SOLUTIONS"` en el video de demo y `.env.example` |
| `668b40f` | **Key Vault: firewall `Deny` + apertura efímera de la IP del runner** |
| `c989c44` | Documenta el cierre del Key Vault y los bloqueos pre-existentes |
| `f23b1c2` | **Repara `environments/staging/`**, que nunca validó |
| `331a69f` | **Evita el reemplazo del Container App Environment** (el fix crítico) |
| `da09871` | Documenta el reemplazo del CAE y los planes reales |
| `65cd8af` | **Azure Bastion pasa a opt-in y queda apagado** (~USD 140/mes evitados) |
| `945357d` | Números autoritativos del plan de CI |
| `2413ec2` | **Frena la deriva perpetua de `workload_profile_name`** (16 recursos) |
| `58c00f6` | Ignora también el `workload_profile` del CAE |

---

## 4. El apply que se ejecutó (runs 32581916076 y 32583410832)

**Aplicado exitosamente en producción:**
- **Key Vault Hardening**: Creado el Private Endpoint `cscs-finops-prod-wus2-kv-pe` vinculado a la VNet y zona DNS privada `privatelink.vaultcore.azure.net`. Firewall en `default_action = Deny` con apertura y cierre efímero automático en CI.
- **Prewarm CronJobs**: Creados los 3 jobs (`prewarm-compute`, `prewarm-databases`, `prewarm-mysql-finops`) y sus correspondientes alertas de métricas.
- **Decisión A Resuelta**: `TF_VARS_PROD` actualizado con `mysql_backup_vault_enabled = false`. Destruido el Data Protection Vault vacío, sus role assignments y el time_sleep.
- **Runbook Orchestrator Importado**: `Orchestrator-Start-Backup-Stop` importado al state mediante bloque `import` declarativo en `environments/prod/main.tf`.
- **Producción Verificada**: `https://finops.cscloudsolutions.com.ar/api/health` → `200 OK` (`status: ok`).

---

## 5. Estado del plan hoy

Último plan de verificación: run **32584071501** sobre `d2ccd90`.

```
Plan: 2 to add, 1 to change, 2 to destroy
```

La app, el CAE, el Key Vault con Private Endpoint y los cron jobs convergen de manera estable y segura.

### Decisión B — el runbook de backups entra en loop

`runbook_type: "PowerShell" -> "PowerShell72"` **sigue apareciendo después de recrear el runbook**. Azure lo
reporta como `PowerShell` pase lo que pase, así que se destruye y recrea en **cada apply, para siempre**.

El detalle que no cierra: el state tiene recursos `azurerm_automation_powershell72_module` (`az_accounts`,
`az_automation`, `az_compute`), o sea que la intención es PS 7.2. Si Azure lo guarda como 5.1, **esos
módulos no le sirven al runbook** y puede ser un problema funcional del sistema de backups, no sólo ruido de
plan.

No se tocó: requiere verificar en el portal cómo está realmente el runbook antes de decidir entre
`ignore_changes`, revertir el tipo a `PowerShell`, o arreglar la creación.

---

## 7. Cómo seguir desde otro IDE

### 7.1 Prerrequisitos

```bash
az login                    # usuario con acceso a CSCS-LandingZone
az account set --subscription ec03e8ce-ceee-4638-b303-64ae431d5b1e
terraform version           # 1.9.8+ (CI usa 1.9.8; azurerm queda pinneado en 4.81.0 por el lock)
```

**Suscripción única del SaaS:** `CSCS-LandingZone` (`ec03e8ce-ceee-4638-b303-64ae431d5b1e`), tenant
`81ebe027-e6af-4e09-bc73-58c9012c6408`.

> La otra suscripción que pueda aparecer en `az account list`, `CSCloudSolution-Production`
> (`0beb7800`), **está dada de baja**: su service principal devuelve `AADSTS7000215`. No aloja nada del SaaS.

### 7.2 Correr un plan localmente (sólo lectura)

```bash
cd infra/terraform/environments/prod
terraform init -input=false -reconfigure \
  -backend-config="resource_group_name=cscs-finops-mgmt-eastus2-rg" \
  -backend-config="storage_account_name=cscsfinopsmgmtqak5xmsa" \
  -backend-config="container_name=tfstate" \
  -backend-config="use_azuread_auth=true" \
  -backend-config="key=prod/terraform.tfstate"

terraform plan -refresh=false -lock=false -var-file=terraform.tfvars
```

`-lock=false` evita dejar el state bloqueado si el comando se corta. `-refresh=false` evita depender del
plano de datos del Key Vault, al que un usuario normal **no** tiene acceso (el RBAC está bien apretado).

> **Trampa importante y verificada:** el plan local **no coincide** con el de CI. El pipeline escribe
> `terraform.tfvars` desde el secret `TF_VARS_PROD`, y ese secret difiere del archivo local (por ejemplo en
> `mysql_backup_vault_enabled`). En una comparación real dieron `12/18/3` local contra `9/26/2` en CI.
> **Los números que valen son los de CI.**

### 7.3 Correr el plan en CI (la fuente de verdad)

Desde la UI: Actions → workflow **terraform** → *Run workflow* → `environment: prod`, `confirm` **vacío**.

Por API:

```bash
gh workflow run terraform.yml -f environment=prod -f confirm=""
```

Para **aplicar**, el mismo dispatch con `confirm=APPLY-PROD`. El apply está siempre detrás de esa
confirmación tipeada; no hay apply automático.

### 7.4 Leer la salida de un run

```bash
gh run view <RUN_ID> --log | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^Plan:|will be destroyed|must be replaced"
```

### 7.5 Validación local antes de pushear

```bash
cd infra/terraform
terraform fmt -check -recursive      # el workflow lo corre: si falla, rompe el CI
for E in prod staging dev; do
  (cd environments/$E && terraform init -backend=false -input=false >/dev/null && terraform validate)
done
```

Los tres deben dar `Success!`.

---

## 8. Trampas conocidas (no volver a pisarlas)

1. **`terraform validate` en verde no dice nada sobre si el apply es seguro.** Hizo falta un plan real
   contra el state para descubrir las 22 destrucciones. Validar no es planificar.
2. **El tfvars local no es lo que usa el pipeline** (§7.2). Cualquier número que no salga de un run de CI es
   orientativo.
3. **`terraform state list` miente si el backend no está inicializado.** Tras un `init -backend=false`
   devuelve vacío y parece que no hay nada en el state. Reinicializar con backend antes de consultarlo.
4. **Terraform no admite dos bloques `lifecycle` por recurso.** Al agregar un `ignore_changes` hay que
   fusionarlo con el que ya exista (varios recursos ya ignoran el tag de imagen, que mueve el pipeline).
5. **Recursos que existen en Azure pero no en el state.** Ya aparecieron tres: la política de backup, el
   hybrid runbook worker y entradas huérfanas de Bastion. El síntoma es `already exists - needs to be
   imported`. Antes de "arreglar" uno, verificar con `az resource show` si existe de verdad.
6. **El patrón de la deriva perpetua.** Atributos que Azure rellena y la configuración no declara
   (`infrastructure_resource_group_name`, `workload_profile_name`, `workload_profile`) hacen que el plan
   nunca converja. Se resuelven con `ignore_changes`. Si aparece un cambio en sitio que sobrevive a su
   propio apply, es esto.
7. **El migration runner parte los archivos SQL sólo en `;` + salto de línea.** Un
   `PREPARE s FROM @ddl; EXECUTE s;` en una sola línea llega junto a `pool.query()` y rompe con
   `ER_PARSE_ERROR`. Probar con el cliente `mysql` no lo detecta: el CLI acepta multi-statement por línea.

---

## 9. Trabajo hecho que todavía no se aplicó

### Key Vault: firewall con apertura efímera (commit `668b40f`)

Implementado en código, **pendiente de apply**. El vault queda en `network_acls.default_action = "Deny"`, la
app entra por private endpoint, y el workflow se agrega a la allowlist sólo mientras dura el plan/apply, con
el cierre en `if: always()`.

La pieza sutil está en `modules/keyvault/main.tf`:

```hcl
lifecycle {
  ignore_changes = [network_acls[0].ip_rules]
}
```

**Sin eso, el propio apply quita la IP que acaba de agregar y se queda afuera con el trabajo a medias.**

Para activarlo hay que agregar tres líneas al secret `TF_VARS_PROD`, dentro del stamp `us`:

```hcl
keyvault_private_endpoint_enabled = true
keyvault_network_acls_enabled     = true
keyvault_allowed_ip_rules         = []
```

Costo: ~USD 7/mes por private endpoint. Procedimiento completo en
[`infra/docs/keyvault-network-hardening.md`](../infra/docs/keyvault-network-hardening.md).

**Recomendación de secuencia:** no mezclar esto con la Decisión A. Primero converger el apply pendiente,
verificar, y recién después activar el Key Vault en un apply separado. Si se hacen juntos y algo se rompe, no
se sabe cuál de los dos fue.

### `environments/staging/`

Ahora valida, pero **ningún workflow lo usa** y la configuración que produjo su state no está en git (el
archivo commiteado nunca fue válido; el apply del 2026-08-06 se hizo desde una copia local). Es inerte.
Su plan actual es de 8 altas, 52 cambios y 1 baja. No aplicar sin revisar aparte.

---

## 10. Pendientes de fondo, sin relación con el apply

- **El repositorio es público.** No es intencional: se agotaron los minutos gratuitos de Actions para repos
  privados. Mientras dure, la topología de red, los nombres de recursos, las cron expressions y la lógica de
  RBAC multi-tenant son legibles por cualquiera. Los secretos **no** están filtrados (el tfvars está
  gitignoreado y los valores viven en Key Vault). También descarta la opción del runner self-hosted dentro
  de la VNet, porque un PR desde un fork ejecutaría código arbitrario ahí.
- **Los minutos.** Medido: CI 4,7 min, deploy a prod 11,5 min, **deploy a staging 21,5 min** (de los cuales
  12,9 son el build de las dos imágenes). Un ciclo completo ronda los 38 min, así que los 2.000 min/mes del
  plan Free se agotan en ~50 ciclos. El build es la palanca, no el testing.
- **El storage de staging está vacío**: `cscsfinopsstgwestus2sa` con 0,02 MiB y 0 transacciones en 24 h, pese
  a tener creados `db-backups`, `executive-reports`, `support-attachments` y `tenant-logos`.
- **`cscs-finops-prod-us-kv`** (eastus2) está en soft-delete con purga automática el **2026-08-27**. No está
  referenciado en ningún archivo. No hay que hacer nada.

---

## 11. Referencias

| Documento | Contenido |
|---|---|
| [`docs/lld/00-lld-completo.md`](lld/00-lld-completo.md) §30 | Inventario verificado, postura de red del Key Vault, el caso del CAE y el del Bastion |
| [`infra/docs/keyvault-network-hardening.md`](../infra/docs/keyvault-network-hardening.md) | Procedimiento de apply del Key Vault, opciones y costos |
| [`infra/docs/pendientes-de-app.md`](../infra/docs/pendientes-de-app.md) | Pendientes de código que dejó la migración |
| [`AGENTS.md`](../AGENTS.md) §15 | Modelo de ramas y pipeline |
