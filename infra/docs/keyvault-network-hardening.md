# Key Vault — cerrar el acceso público de red

**Estado: ABIERTO.** Inventario y análisis verificados contra la suscripción el
**2026-08-22**. No es un cambio de una variable: hay un bloqueo concreto en el
pipeline que hay que resolver primero. Leer entero antes de tocar el tfvars.

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
public_network_access_enabled = var.private_endpoint_enabled ? false : true
```

Y el stamp de prod tiene `keyvault_create = true`, así que el vault es un
recurso gestionado (`azurerm_key_vault.this[0]`) y no un `data` referenciado:
el atributo está bajo control de Terraform. Activar
`keyvault_private_endpoint_enabled = true` crea el private endpoint, lo enlaza
a la zona privada y cierra el acceso público, todo junto.

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

### 1. Firewall con apertura efímera — recomendada

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

## Antes que todo esto: el repositorio es público

`manny864/finops` tiene `visibility: public`. `terraform.tfvars` está
gitignoreado (`infra/.gitignore`) y los secretos viven en Key Vault, así que a
primera vista no hay credenciales filtradas — pero la topología de red
completa, los nombres de recursos, las expresiones cron y la lógica de RBAC
multi-tenant del SaaS son legibles por cualquiera.

Si eso no es deliberado, **cerrar el repo vale más que cualquier private
endpoint**, y además desbloquea la opción 3.

## Cómo aplicar el cambio cuando se decida

`infra/terraform/environments/prod/terraform.tfvars` está gitignoreado
(`infra/.gitignore`: `*.tfvars`) y el workflow lo escribe desde el secret
`TF_VARS_PROD`. Editar el archivo local **no llega a CI**: hay que actualizar
ese secret de GitHub además del archivo.
