# CSCloudSolutions FinOps — Infraestructura Azure (Terraform)

Migración de **FinOps** (`finops.cscloudsolutions.com.ar`) desde el VPS
Hostinger a Azure. Región principal: **West US 2**.

## Por qué migrar

El motivo no es el costo ni la saturación — el
[plan de infra del VPS](../docs/vps-infra-improvement-plan.md) ya endureció lo
que se podía endurecer a costo cero. Los tres motivos reales son:

1. **El crontab no está en git.** Los 14 procesos de `/api/cron/*` viven en el
   crontab manual del VPS. El README documenta dos incidentes en los que un job
   estuvo ausente del crontab real mientras la documentación decía que corría, y
   tres tablas de costo quedaron vacías durante semanas sin error visible. Acá
   el schedule es código y se revisa en PR.
2. **Punto único de falla.** Un VPS, sin redundancia, con la app, Redis y MySQL
   en la misma máquina, y deploys con downtime durante el build.
3. **La residencia de datos está a medio camino.** `Tenants.data_residency` ya
   es un ENUM con auditoría y locking, y `regionPool.ts` ya expone
   `getTenantPool()`. Falta el segundo despliegue físico para que deje de ser
   una declaración y pase a ser una garantía.

## Arquitectura

```text
Usuarios ──► Cloudflare (WAF/TLS/CDN)
                │
                ▼
        Container App "web"  ◄── Container Apps Jobs (14 schedules + migrate)
        Next.js standalone
                │
   ┌────────────┼──────────────┬───────────────┬──────────────┐
   ▼            ▼              ▼               ▼              ▼
 MySQL       Redis        Key Vault         Blob         ARM APIs de
Flexible    (cache)      (existente)   (adjuntos/logos)  los clientes
```

Diagrama completo en `docs/architecture.mmd`.

## Qué cambia respecto del VPS

| Hoy | En Azure | Por qué |
|---|---|---|
| Crontab manual del VPS | **Container Apps Jobs** con `cron_jobs` en tfvars | El schedule viaja con el repo; ya hubo dos incidentes por su ausencia |
| Endpoints `/api/cron/*` invocados con `curl` | Los mismos endpoints, invocados por un Job | La lógica se queda en la app: comparte pool de MySQL, servicios y `requestAuth`. Reescribirlos como Functions duplicaría la lógica de costos (`decimal.js`) en dos runtimes |
| `healthchecks.io` como dead-man switch | Alerta de Azure Monitor por job fallido | El scheduler ahora es Azure y reporta ejecuciones fallidas él mismo |
| Volumen Docker `support_uploads` | **Blob Storage** | El filesystem de un contenedor es efímero. **La app ya soporta Blob** (`azureBlobStorage.ts`): sólo hay que crear los containers y copiar los archivos |
| MySQL en compose aparte del VPS | **MySQL Flexible Server** | Backups con PITR, sin host que parchear |
| Redis en el compose | **Azure Cache Basic** | Para que la app pueda escalar a más de una réplica compartiendo cache |
| `backup-db.sh` + cron + SAS | Backups del servicio + container `db-backups` | El dump lógico del runbook sigue teniendo sentido; el respaldo ya no depende de un script — retención y operación en `docs/backups-mysql.md` |
| Deploy por SSH con downtime | ACR build → job de migraciones → revisión nueva | Sin downtime de build, con rollback por revisión |
| `.env` plano en el VPS | Secrets del Container App con referencia a Key Vault | Los valores no pasan por el state ni por el portal |

## Estructura

```text
terraform/
  bootstrap/          storage account del estado remoto
  runners/            runners Azure separados para Terraform de prod/staging
  environments/
    dev/  prod/       plano de control + N stamps
  modules/
    stamp/            ← la celda regional: compone todo lo de abajo
    containerapp/     app web con autoescalado por requests
    cronjobs/         ← los 14 procesos periódicos
    storage/          ← blob: adjuntos, logos y backups
    mysql/  redis/  keyvault/  network/  private_dns/
    monitoring/       Log Analytics + Application Insights + action group
    diagnostics/      logs de KV/MySQL/Redis/Storage → Log Analytics
    security_policy/  lock de prod + alerta de app caída
    budget/           presupuesto por RG con alertas
    acr/              GLOBAL — registry
    defender/         GLOBAL — Defender for Cloud (alcance suscripción)
pipelines/github-actions/
  terraform.yml       checkov + Infracost + plan en PR, apply manual, drift semanal
  deploy.yml          ACR build → migraciones → web → los 14 jobs → health check
docs/
  migracion-desde-vps.md   el corte, paso a paso (ya ejecutado — histórico)
  residencia-de-datos.md   qué falta para que sea real
  cost-optimization.md
  deployment-guide.md
  keyvault-network-hardening.md  cerrar el acceso público del vault — ABIERTO
  backups-mysql.md         retención daily/monthly/yearly y el incidente del 22/08
```

## Stamps y residencia de datos

Un **stamp** es todo lo que toca datos de clientes en una región. Hoy hay uno
(`us`), y la clave del mapa `stamps` es el valor de `Tenants.data_residency` que
atiende. Agregar Europa es agregar una clave — ver `docs/residencia-de-datos.md`.

## Costos

~USD 210–280/mes en prod, ~40 en dev. Desglose en `docs/cost-optimization.md`.
Con el crédito de Microsoft for Startups eso está cubierto; el desglose importa
igual para saber qué apagar cuando el crédito termine.

## Flags que valen la pena conocer

| Variable | Default | Qué hace |
|---|---|---|
| `stamps` | 1 clave (`us`) | Cada clave más es una región completa |
| `cron_jobs` | 14 jobs | El reemplazo del crontab. Comentar una entrada apaga ese job |
| `mysql_high_availability` | `false` | Standby zone-redundant — **exige** sku `GP_*` |
| `web_min_replicas` | `1` (`0` en dev) | En 0 no se paga cuando nadie usa el ambiente |
| `allowed_ip_ranges` | `[]` | Restringe el ingress a Cloudflare |
| `defender_enabled` | `false` | Defender for Cloud. Alcance **suscripción** |
| `zone_redundant` | `true` | **No se puede cambiar después de crear el entorno** |
| `stamps.<clave>.ai_services_enabled` | `false` | Cuenta de Azure AI Services del stamp (`modules/ai_services`): private endpoint, `gpt-5.4-mini` Data Zone y la identidad de la app como credencial. Unos US$9/mes fijos más el consumo, con presupuesto propio de US$50. Ver *IA de plataforma* abajo |
| `stamps.<clave>.ai_services_location` | `null` (la del stamp) | Región de la cuenta de IA. West US 2 no ofrece modelos de Azure OpenAI: `us` usa `westus3` |
| `stamps.<clave>.ai_services_entra_auth` | `true` | Pasa la app a la cuenta nueva con Entra ID. En `false` crea sólo la infraestructura y la app sigue con la key |
| `keyvault_private_endpoint_enabled` | `true` | Private endpoint del vault; el endpoint público permanece detrás del firewall Deny para runners — leer `docs/keyvault-network-hardening.md` |
| `blob_managed_identity_enabled` | `true` | Blob por identidad administrada; coherente con Shared Key apagada |
| `storage_shared_access_key_enabled` | `false` | Sólo Entra ID; reactivar claves bloquea Checkov |

## IA de plataforma (`ai_services`)

La cuenta se prende por stamp y en pasos. El detalle está en el LLD §41 y en la
propuesta de IA, sección 10.6.

1. Confirmar la cuota Data Zone de `gpt-5.4-mini` en West US 3 y actualizar el
   centro de confianza, que hoy dice «despliegue único en West US 2».
2. Apply con `ai_services_enabled = true`, `ai_services_location = "westus3"` y
   `ai_services_entra_auth = false`: crea la infraestructura y la app sigue con
   la key.
3. Desde el contenedor, `<cuenta>.openai.azure.com` tiene que resolver a
   `10.50.10.x`. Si resuelve a la IP pública falta una zona DNS y la llamada
   falla con 403.
4. Apply con `ai_services_entra_auth = true`, con Azure IA como proveedor de
   plataforma en *IA — Configuración global*. Volver a `false` es la vuelta
   atrás, sin borrar la cuenta.
5. `local_auth_enabled` ya es `false` por defecto en `modules/ai_services`:
   las cuentas nuevas no aceptan keys. Borrar la key heredada del panel sólo
   después de verificar Entra ID; no afecta cuentas ajenas a este Terraform.
   Checkov bloquea reactivar autenticación local, sin excepción global.

## Análisis de seguridad de CI (INFRA-10)

El job `scan` de `.github/workflows/terraform.yml` analiza Terraform,
Dockerfile y GitHub Actions sin login, OIDC ni acceso al state. Checkov está
fijado en `infra/checkov/requirements.txt`; el mismo ejecutable corre los
controles negativos. SARIF es informativo: sólo su subida puede fallar sin
bloquear, no el análisis.

No hay skips globales ni baseline que silencie hallazgos nuevos. Las
excepciones están junto al recurso, con dueño, fecha límite y riesgo/control
compensatorio. `check-checkov-exceptions.py` bloquea excepciones vencidas,
sin datos o con revisión a más de 120 días. Shared Key, autenticación local
de AI y firewall de Key Vault son controles no suprimibles.

La política local `CKV2_FINOPS_1` también detecta la eliminación del bloque
de firewall del backend (el check nativo puede dejarlo como UNKNOWN). Sólo
el Storage de la app mantiene una excepción específica: continúa público
con RBAC/ABAC, no tiene aislamiento de red. Los demás riesgos aceptados
siguen visibles en los comentarios; no significan remediación de esos recursos.

Para reproducir sin copiar tfvars/state ignorados, instalar el requirements
en un virtualenv, poner su `bin` en PATH y ejecutar desde la raíz:

```bash
python3 infra/scripts/check-checkov-exceptions.py
python3 infra/scripts/test-checkov-regressions.py
```

La segunda orden copia sólo fuentes versionadas y archivos nuevos no ignorados
del alcance del scan a un directorio temporal. Comprueba los tres frameworks,
errores de parseo, política local y regresiones reales; elimina su copia al
terminar. No usa secretos, planes ni providers locales.
