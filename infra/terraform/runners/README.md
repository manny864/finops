# Runners privados de Terraform

Dos VMs encendidas en `westus2`, una por ambiente, desplegadas el 2026-10-15.
Root independiente del stamp y del bootstrap: su state local **no** administra
el Storage del state de la aplicacion. No publicar state, planes, claves ni tfvars.

| Ambiente | VM | Resource group | Label |
|---|---|---|---|
| staging | `cscs-finops-staging-runner` | `cscs-finops-staging-runner-rg` | `finops-staging` |
| prod | `cscs-finops-prod-runner` | `cscs-finops-prod-runner-rg` | `finops-prod` |

## Configuracion y costo

- `Standard_B2s_v2`: 2 vCPU y 8 GB por VM, Ubuntu 24.04, SSD Standard de 64 GB.
  `B2as_v2` paso la comprobacion de cuota pero Azure rechazo ambas asignaciones
  por falta de capacidad. No quedaron VMs fallidas adicionales.
- Precio publico Linux pay-as-you-go consultado el 2026-10-15:
  USD 0,0832/h por VM, USD 121,47 por 730 horas entre ambas. Adicionales:
  dos discos, dos IPv4 Standard y trafico; no es un total de factura.
- VNet separada por ambiente (`10.71.0.0/24`, `10.72.0.0/24`), sin peering
  ni enlaces a las zonas DNS privadas de los stamps.
- Service endpoints `Microsoft.Storage.Global` (backend eastus2) y
  `Microsoft.KeyVault` (vault westus2). El endpoint del servicio sigue publico,
  pero con default Deny y reglas de subred; no son private endpoints.
- IPv4 publica por NIC para salida explicita, sin NAT Gateway. NSG deniega
  **toda** entrada, tambien SSH, y restringe salida a TCP 80/443. DNS de Azure
  y comunicacion del agente de plataforma conservan las excepciones de Azure.
- Secure Boot, vTPM, cifrado de host y parches/assessment AutomaticByPlatform.
  Actualizaciones de seguridad del guest habilitadas.
- Sin managed identity ni RBAC de datos en la VM. Los jobs conservan OIDC
  y sus identidades distintas de prod/staging.

## Registro y seguridad del runner

Cloud-init instala Azure CLI desde el repositorio firmado de Microsoft,
Terraform 1.9.8 con checksum y Actions Runner 2.338.0 con SHA256 fijado.
El runner permite sus actualizaciones automaticas de GitHub; la version inicial
no implica permanecer indefinidamente en esa version.

```bash
python3 infra/scripts/configure-private-runner.py staging
python3 infra/scripts/configure-private-runner.py prod
gh api repos/manny864/finops/actions/runners \
  --jq '[.runners[] | {name,status,busy}]'
```

El registro usa tokens de GitHub de una hora, pasados por `protectedParameters`
de Managed Run Command y archivo temporal local con modo 0600. No van en
cloud-init, Terraform, argumentos del CLI ni scripts publicados. El recurso de
Run Command se elimina tras ejecucion terminal. El runner guarda su credencial
operativa en su disco: tratar la VM como recurso sensible.

Servicio systemd bajo `actions`, sin sudo ni pertenencia al grupo Docker.
Administracion por Azure Run Command; la cuenta de administracion por clave
no tiene entrada de red autorizada. Quien tenga permiso para Run Command o
administrar el disco puede controlar el runner.

Hook de inicio root-owned: exige este repositorio, `refs/heads/main`, eventos
dispatch/schedule/workflow_run y workflow Terraform o reconciliador. Rechaza
PRs y otros workflows antes de ejecutar pasos. Hook final elimina los tfvars,
planes y posibles states locales de prod/staging. No sustituye runners efimeros
ni elimina todo rastro de un job malicioso: las VMs persistentes y las etiquetas
**no** son una frontera fuerte entre workflows del mismo repositorio personal.
No ejecutar codigo no confiable y no otorgar sudo al usuario `actions`.

## Conectividad y publicacion pendiente

Las dos subredes estan autorizadas en el Storage `cscsfinopsmgmtqak5xmsa`;
cada una solo en su propio vault. Propiedad de configuracion:

- Storage: `bootstrap/main.tf`, variable `runner_subnet_ids`. El tfvars local
  del bootstrap contiene ambos IDs de `terraform output -json runners`.
  Conservarlos al reconstruir la configuracion del bootstrap.
- Key Vault: `keyvault_runner_subnet_ids` en `environments/*/network.tfvars`,
  propagada por stamp al modulo Key Vault.
- No administrar las mismas ACL desde el root de runners.

La aplicacion inicial de las reglas fue por ARM, sin abrir default Allow.
Las pruebas de cada VM comprobaron cinco lecturas autenticadas consecutivas
de su contenedor y su vault, y rechazo **ForbiddenByFirewall** del vault ajeno.
Se usaron tokens temporales del operador, no OIDC de Actions: esto demuestra
la ruta de red, no sustituye probar los jobs reales y su aislamiento RBAC.

```bash
python3 infra/scripts/verify-private-runner.py staging
python3 infra/scripts/verify-private-runner.py prod
```

Los selectores `runs-on` estan preparados localmente para plan/apply, drift y
reconciliador. **No se hizo push**: los workflows remotos siguen en hosted Ubuntu.
No aplicar Terraform desde una version anterior a estas ACL: puede retirar las
subredes. Publicar configuracion y probar planes de ambos ambientes, OIDC,
aislamiento de contenedores y reconciliacion antes de cerrar INFRA-09.
Builds/tests y scans de PR continuan en GitHub-hosted Linux. Por bloqueo de
facturacion de runners hosted detectado durante la activacion, el scan
bloqueante de dispatch manual desde `main` usa la VM del ambiente, sin OIDC.
PRs y otras ramas no pueden seleccionar esos runners para el scan.

Durante la transicion se conserva la apertura/cierre de IPs temporales y el cron
de 15 minutos. Su retirada requiere migrar **todos** los consumidores y limpiar
leases anteriores. Este despliegue no elimina silenciosamente ese mecanismo.

## State y mantenimiento

Conservar copia protegida de `terraform.tfstate` de este root fuera de git,
igual que el bootstrap. Perderlo no elimina las VMs, pero obliga a recuperarlo
o importarlas antes de operar. El root no contiene tokens de GitHub.

Para planificar recursos existentes sin depender de la clave privada local:

```bash
export TF_VAR_subscription_id=$(az account show --query id -o tsv)
export TF_VAR_admin_public_key=$(az vm show \
  -g cscs-finops-prod-runner-rg -n cscs-finops-prod-runner \
  --query 'osProfile.linuxConfiguration.ssh.publicKeys[0].keyData' -o tsv)
terraform -chdir=infra/terraform/runners init -lockfile=readonly
terraform -chdir=infra/terraform/runners plan
```

No ejecutar `configure-private-runner.py` mientras el runner este ocupado:
el script lo rechaza y reinicia el servicio al actualizar hooks.
Cambiar cloud-init fuerza reemplazo de las VMs; revisar siempre el plan.
Mantener imagen y herramientas actualizadas de forma deliberada.

## Desasignacion y baja

Mientras el cron y los jobs dependan de estos runners deben estar disponibles.
Desasignarlas no elimina disco ni IPv4, que pueden seguir facturandose.
No hay encendido bajo demanda implementado.

Para una baja definitiva, con aprobacion y consumidores detenidos:

1. Verificar que ningun runner este ocupado; detener servicios y migrar o
   desactivar los jobs que usen sus labels.
2. Eliminar cada registro de GitHub con
   `gh api --method DELETE repos/manny864/finops/actions/runners/<id>`.
3. Retirar de bootstrap y de `network.tfvars` las reglas de subred y aplicarlas.
   Conservar acceso alternativo antes de hacerlo.
4. Revisar y aplicar `terraform destroy` **solo en este root**, retirando las
   VMs, discos, NICs, IPv4, subredes, VNets y NSGs exclusivos.
5. Conservar el Storage y los states de la aplicacion. No destruir bootstrap
   ni los stamps para dar de baja los runners.
