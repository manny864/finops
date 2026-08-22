# Key Vault — cerrar el acceso público de red

**Estado: IMPLEMENTADO EN CÓDIGO, PENDIENTE DE APPLY.** Inventario y análisis
verificados contra la suscripción el **2026-08-22**. Se eligió la **opción 1**
(firewall con apertura efímera) y ya está en el repo: módulo, variables,
workflow y tfvars. Falta el `terraform apply` manual, que es la única acción
que toca Azure. Leer "Cómo aplicarlo" al final antes de dispararlo.

## Inventario real

Todo el SaaS vive en **CSCS-LandingZone** (`ec03e8ce-ceee-4638-b303-64ae431d5b1e`),
tenant `81ebe027`.

| Key Vault | Resource Group | Región | Estado de red |
|---|---|---|---|
| `cscs-finops-prod-wus2-kv` | `cscs-finops-prod-westus2-rg` | westus2 | `publicNetworkAccess: Enabled` |
| `cscs-finops-stg-wus2-kv` | `cscs-finops-stg-westus2-rg` | westus2 | `publicNetworkAccess: Enabled` |

Los dos tienen RBAC authorization, soft-delete y purge protection activos, sin
access policies heredadas. La exposición pública es de **plano de
autenticación**, no de datos: sin un token con rol asignado no se lee nada.

Hay un tercer vault en soft-delete, `cscs-finops-prod-us-kv` (eastus2), borrado
el 2026-07-28 con purga programada para el **2026-08-27**. No está referenciado
en ningún archivo del repo y se purga solo. No hay nada que hacer con él salvo
recuperarlo antes de esa fecha si resultara que guarda algo.

## Lo que Terraform ya resuelve

El módulo lo tiene implementado desde el principio —
[`modules/keyvault/main.tf`](../terraform/modules/keyvault/main.tf):

```hcl
public_network_access_enabled = var.network_acls_enabled || !var.private_endpoint_enabled
```

Y el stamp de prod tiene `keyvault_create = true`, así que el vault es un
recurso gestionado (`azurerm_key_vault.this[0]`) y no un `data` referenciado:
el atributo está bajo control de Terraform.

**Del lado de la aplicación está todo listo.** El Container App Environment
está inyectado en la VNet (`infrastructure_subnet_id = module.network.apps_subnet_id`,
[`modules/stamp/main.tf`](../terraform/modules/stamp/main.tf)), la subnet de
private endpoints existe con `private_endpoint_network_policies = "Disabled"`,
y la zona `privatelink.vaultcore.azure.net` ya está creada y enlazada a la
VNet. La app resolvería el vault por IP privada sin ningún cambio de código.

## Por qué no alcanza con activar la variable

Terraform gestiona **dos secretos en el plano de datos** del vault:

| Recurso | Archivo |
|---|---|
| `azurerm_key_vault_secret.cron` | `modules/stamp/main.tf` |
| `azurerm_key_vault_secret.mysql_password` | `modules/stamp/main.tf` |

Cada `plan` los refresca con un GET al data plane. Y tanto el `apply` como la
detección de drift de los lunes corren en `runs-on: ubuntu-latest` — runners
públicos de GitHub, sin ruta a `10.50.0.0/16`.

**Consecuencia:** apenas se cierre el acceso público, el drift semanal empieza
a fallar y el apply manual deja de poder correr desde Actions. El síntoma sería
un 403 o un timeout contra el data plane del vault, no un error de Terraform.

## Opciones, con lo que cuesta cada una

### 1. Firewall con apertura efímera — ELEGIDA E IMPLEMENTADA

Dejar `public_network_access_enabled = true` pero con `network_acls` en
`default_action = "Deny"`, y que el job de Terraform se agregue a la allowlist
antes del plan y se saque después:

```bash
IP=$(curl -s https://api.ipify.org)
az keyvault network-rule add    --name cscs-finops-prod-wus2-kv --ip-address "$IP"
# terraform plan / apply
az keyvault network-rule remove --name cscs-finops-prod-wus2-kv --ip-address "$IP"
```

Combinado con el private endpoint: la app entra por privado, el vault queda
cerrado salvo por una IP única durante los ~2 minutos del apply. Sin
infraestructura nueva. Costo: el private endpoint, ~USD 7/mes por vault.

Requiere que el `remove` corra siempre (`if: always()`), o la allowlist se
llena de IPs muertas de runners.

**Cómo quedó implementado:**

| Pieza | Dónde |
|---|---|
| `network_acls` con `default_action = "Deny"` y `bypass = "AzureServices"` | `modules/keyvault/main.tf` |
| `lifecycle.ignore_changes = [network_acls[0].ip_rules]` | `modules/keyvault/main.tf` |
| Variables `network_acls_enabled` / `allowed_ip_rules` | `modules/keyvault/variables.tf` |
| Paso por el stamp y los tres environments | `modules/stamp/`, `environments/*/` |
| Output `key_vault_names` que consume el workflow | `environments/*/outputs.tf` |
| Pasos "Abrir/Cerrar el Key Vault" en `plan-apply` y en `drift` | `.github/workflows/terraform.yml` |
| `keyvault_private_endpoint_enabled` + `keyvault_network_acls_enabled` en `true` | `environments/prod/terraform.tfvars` |

El `ignore_changes` es la pieza sutil y la que más importa: sin él, el propio
`terraform apply` vería la IP que el workflow acaba de agregar como drift y la
quitaría **mientras la está usando**. Se cierra la puerta con la llave adentro.

El paso de apertura tolera que el output `key_vault_names` todavía no exista:
en el primer apply el firewall aún no está creado y el vault está abierto, así
que no hay nada que permitir.

### 2. Sacar los dos secretos de Terraform

`terraform state rm` de `cron` y `mysql_password`, y cargarlos fuera del ciclo
de vida de Terraform. Elimina la dependencia de data plane de raíz. El costo es
perder el manejo declarativo de su rotación y del `expiration_date`.

### 3. Runner self-hosted dentro de la VNet — DESCARTADA

Sería la solución de manual: un runner con IP privada resuelve el private
endpoint y Terraform funciona sin excepciones de firewall. En este repo **no se
puede**.

`manny864/finops` es un repositorio **público**, y `terraform.yml` dispara en
`pull_request` sobre `infra/terraform/**`. Cualquiera puede forkear, abrir un PR
que toque esa ruta, y su código se ejecutaría en una máquina dentro de la VNet
de producción, con la managed identity que tiene `Key Vault Secrets Officer`
sobre el vault que se está tratando de blindar. Se cerraría el vault a internet
para abrirle una puerta con credenciales adentro.

Es la razón por la que GitHub desaconseja runners self-hosted en repos
públicos. Las mitigaciones (aprobación manual para contribuidores nuevos,
secrets no propagados a forks) dependen de configuración que se afloja sin que
nadie se entere.

La variante gestionada —*larger runners* con Azure private networking— tampoco
aplica: exige GitHub Team/Enterprise sobre una **organización**, y el repo
pertenece a una cuenta de usuario.

## El repositorio es público, y por qué

`manny864/finops` tiene `visibility: public`. **No es la intención**: el repo
normalmente es privado y se abrió porque se agotaron los minutos gratuitos de
GitHub Actions para repos privados — en público los minutos de los runners
estándar no se cobran, y sin eso no había forma de deployar.

Es un intercambio consciente, pero conviene tenerlo escrito: `terraform.tfvars`
está gitignoreado y los secretos viven en Key Vault, así que no hay
credenciales filtradas, pero la topología de red completa, los nombres de
recursos, las expresiones cron y la lógica de RBAC multi-tenant del SaaS son
legibles por cualquiera mientras dure.

Volver a privado es lo que desbloquea la opción 3, y las salidas son:

| Camino | Costo | Nota |
|---|---|---|
| GitHub Team | ~USD 4/usuario/mes | 3.000 min/mes incluidos. Además habilita *larger runners* con Azure private networking, que es la opción 3 en versión gestionada |
| Runner self-hosted para el build | el fierro | Los minutos de runners propios **no se cuentan** contra la cuota. Con el repo privado deja de ser peligroso, y puede correr como Container Apps Job en el Environment que ya existe |
| Reducir minutos | 0 | El grueso se lo lleva el build de la imagen. Cachear capas en ACR o mover el build a ACR Tasks descarga al runner |

Mientras el repo siga público, la opción 3 queda descartada y el firewall
efímero de la opción 1 es la respuesta correcta.

## Cómo aplicarlo

1. **Actualizar el secret `TF_VARS_PROD`** con el contenido nuevo de
   `environments/prod/terraform.tfvars` (el archivo local está gitignoreado por
   `infra/.gitignore`: el workflow lo escribe desde ese secret, así que editar
   el archivo **no llega a CI**). Las tres líneas nuevas van dentro del stamp `us`:

   ```hcl
   keyvault_private_endpoint_enabled = true
   keyvault_network_acls_enabled     = true
   keyvault_allowed_ip_rules         = []
   ```

2. **Lanzar el workflow en modo plan** (`workflow_dispatch` con `confirm`
   vacío) y leer la salida. El plan medido el 2026-08-22 contra el state real
   es de **12 altas, 18 cambios y 3 bajas**. Del Key Vault salen exactamente
   una alta (`azurerm_private_endpoint.vault[0]`) y un cambio
   (`network_acls.default_action: Allow → Deny`).

   Las tres bajas están caracterizadas en `docs/lld/00-lld-completo.md` §30.7 y
   ninguna es de la app: son el runbook de backups (cambio deliberado a
   PowerShell72), un Data Protection vault vacío que el tfvars ya pide apagar,
   y un role assignment que sólo aparece si el plan se corre con una identidad
   distinta a la del SP de CI. **Si aparece cualquier baja fuera de esas tres
   —sobre todo el Container App Environment— parar y revisar.**

3. **Aplicar** relanzando con `confirm = APPLY-PROD`. Durante este apply el
   vault todavía está abierto, así que no hace falta la excepción de firewall.

4. **Verificar** que la app sigue leyendo secretos: `/api/health` en 200 y sin
   errores de Key Vault en los logs del Container App. El private endpoint tarda
   un par de minutos en propagar por DNS.

5. **Confirmar el lunes siguiente** que el job de drift pasa. Es la prueba real
   de que el ciclo abrir → plan → cerrar funciona: es el primer plan que corre
   con el vault ya cerrado.

Rollback: poner `keyvault_network_acls_enabled = false` y volver a aplicar. El
private endpoint puede quedarse; no molesta.

## Costo

~USD 7/mes por private endpoint. Con un solo stamp, ~USD 7/mes en total. El
firewall y las reglas de red no tienen cargo.
