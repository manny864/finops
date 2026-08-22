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
| `backup-db.sh` + cron + SAS | Backups del servicio + container `db-backups` | El dump lógico del runbook sigue teniendo sentido; el respaldo diario ya no depende de un script |
| Deploy por SSH con downtime | ACR build → job de migraciones → revisión nueva | Sin downtime de build, con rollback por revisión |
| `.env` plano en el VPS | Secrets del Container App con referencia a Key Vault | Los valores no pasan por el state ni por el portal |

## Estructura

```text
terraform/
  bootstrap/          storage account del estado remoto
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
    frontdoor/        GLOBAL — geo-routing, sólo con 2+ stamps
pipelines/github-actions/
  terraform.yml       checkov + Infracost + plan en PR, apply manual, drift semanal
  deploy.yml          ACR build → migraciones → web → los 14 jobs → health check
docs/
  migracion-desde-vps.md   el corte, paso a paso (ya ejecutado — histórico)
  residencia-de-datos.md   qué falta para que sea real
  cost-optimization.md
  deployment-guide.md
  keyvault-network-hardening.md  cerrar el acceso público del vault — ABIERTO
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
| `frontdoor_enabled` | `false` | Sólo útil con 2+ stamps |
| `zone_redundant` | `true` | **No se puede cambiar después de crear el entorno** |
| `keyvault_private_endpoint_enabled` | `false` | Private endpoint del vault **y** cierre del acceso público. Rompe el plan/apply desde runners de GitHub — leer `docs/keyvault-network-hardening.md` antes de activarlo |
