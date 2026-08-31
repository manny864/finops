# Corte del VPS a Azure — paso a paso

> **RUNBOOK YA EJECUTADO — se conserva como registro histórico.**
>
> El corte se hizo el **2026-07-28**: el VPS quedó congelado ese día y la
> plataforma corre desde entonces en Container Apps sobre el stamp `us`
> (West US 2). `deploy.yml` (SSH al VPS) quedó en `workflow_dispatch` y **no
> debe volver a tener trigger de push**: apuntaría a un host muerto y migraría
> su base de datos rancia.
>
> Los pasos de abajo están en futuro porque así se escribieron antes del corte.
> Sirven para auditar qué se hizo y para reusar la secuencia en el segundo
> stamp (`eu`), no como tarea pendiente.


Orden pensado para que el VPS siga sirviendo hasta el último momento y el
rollback sea volver a apuntar el DNS.

## 0. Antes de tocar nada

**Verificar la zona horaria del crontab.** Container Apps interpreta las
expresiones cron en **UTC**. Las de `terraform.tfvars.example` son las mismas
del crontab del VPS tal cual:

```bash
ssh finops-vps 'date; crontab -l'
```

Si el VPS corre en hora local de Argentina (UTC-3), hay que sumar 3 horas a
todas las expresiones diarias. El comentario de `historical-gap-backfill` en el
README dice "03:00 UTC", lo que sugiere que el VPS ya está en UTC — pero
confirmarlo, porque si está mal el snapshot diario de costos corre a la hora
equivocada y nadie se entera.

**Contrastar el crontab real contra el Terraform.** El README avisa que
`anomaly-detection`, `cost-sync-staleness-check` y `focus-export-daily` estaban
documentados pero no confirmados en el crontab real al 2026-07-18. Si alguno no
corre hoy, decidir explícitamente si debe correr — no arrastrar la duda.

```bash
terraform output cron_schedules   # comparar contra crontab -l
```

## 1. Infraestructura

```bash
cd infra/terraform/bootstrap && terraform init && terraform apply
cd ../environments/prod
cp terraform.tfvars.example terraform.tfvars   # completar; NO commitear
terraform init -backend-config=...             # ver deployment-guide.md
terraform apply
```

## 2. Datos

### MySQL

```bash
# en el VPS
docker exec <mysql> mysqldump -u root -p --single-transaction \
  --routines --triggers --set-gtid-purged=OFF <nombre-de-la-base-origen> > finops.sql
# contra Azure (48 tablas)
mysql -h <output mysql_fqdns> -u finops_admin -p --ssl-mode=REQUIRED finops < finops.sql
```

MySQL queda con VNet injection: **no es alcanzable desde internet**. Correr el
restore desde el Container App Job, desde una VM en la misma VNet, o habilitar
el acceso público temporalmente durante la carga.

La password la generó Terraform y está en Key Vault como
`infra-db-password-azure-us` — **no** pisa `infra-db-password`, que es el que
sigue leyendo el VPS mientras ambos convivan.

Verificar contra el VPS: `SELECT COUNT(*)` de `Tenants`, `CostSnapshots`,
`ActionLogs` y `Subscriptions` antes de seguir.

### Archivos (adjuntos de soporte y logos)

No hay cambio de código: `src/lib/supportAttachments.ts` y
`src/lib/tenantLogo.ts` ya conmutan a Blob cuando `isBlobStorageEnabled()` ve
`AZURE_STORAGE_CONNECTION_STRING`, que Terraform inyecta como secret. Sólo hay
que copiar lo que ya existe:

```bash
ACCOUNT=$(terraform output -raw storage_accounts | ...)   # o del portal
az storage blob upload-batch --account-name "$ACCOUNT" \
  -d support-attachments -s ./data/support-attachments --auth-mode login
az storage blob upload-batch --account-name "$ACCOUNT" \
  -d tenant-logos -s ./data/tenant-logos --auth-mode login
```

Los `stored_name` en la base son UUIDs y no cambian, así que las filas de
`SupportTicketAttachments` y el logo de cada tenant siguen resolviendo.

### Secretos

El Key Vault es el mismo, así que las credenciales por tenant
(`tenantCredentials.ts`) y los secretos de infra no se migran. Lo que sí hay
que hacer es completar `key_vault_secret_ids` / `key_vault_secret_env` en el
tfvars con Paddle, WorkOS, SMTP, MFA y SSO: hoy están en el `.env` plano del
VPS, y ese archivo no viaja.

## 3. Verificación con el VPS todavía vivo

Con el DNS todavía apuntando al VPS, contra el FQDN del Container App:

- `/api/health` responde 200.
- Login con Entra ID (agregar la URL del Container App como redirect URI en la
  App Registration — se pueden tener las dos registradas a la vez).
- Disparar a mano los jobs pesados y mirar el resultado:
  ```bash
  az containerapp job start -g cscs-finops-prod-westus2-rg -n cron-sync
  az containerapp job execution list -g cscs-finops-prod-westus2-rg --name cron-sync -o table
  ```
- Confirmar que un adjunto viejo se descarga (llegó a Blob) y que subir uno
  nuevo funciona.
- Revisar el throttling de Resource Graph: la IP de salida cambia, pero el
  límite de 429 es por tenant del cliente, no por origen —
  `src/lib/argConcurrency.ts` sigue siendo necesario.

## 4. El corte

1. Poner el VPS en modo lectura o avisar la ventana.
2. Dump final de MySQL y restore (paso 2).
3. Sincronizar los archivos nuevos que hayan entrado desde la primera copia.
4. Apuntar `finops.cscloudsolutions.com.ar` al Container App. Para el
   certificado gestionado, el registro tiene que estar en **DNS-only** en
   Cloudflare durante la validación; después vuelve a **Proxied** con SSL
   *Full (strict)*.
5. Cargar los rangos de Cloudflare en `allowed_ip_ranges` y `terraform apply`.
6. **Desactivar el crontab del VPS** (`crontab -r` después de guardarlo), o los
   jobs corren dos veces contra la misma base.
7. Actualizar la URL de los webhooks de Paddle y del marketplace de Azure.
8. Dejar el VPS prendido una semana como rollback antes de bajarlo.

## 5. Después del corte

- Sacar `SERVER_HOST`, `SERVER_USER` y `SSH_PRIVATE_KEY` de los secrets del
  repo.
- Los checks de healthchecks.io quedan redundantes: la alerta de job fallido de
  Azure Monitor los reemplaza. Borrarlos o dejarlos como segunda opinión, pero
  no mantener los dos sistemas a medias.
- **Corregir `docs/data-residency.md`**: dice "hoy sólo operamos un datacenter
  real (Azure Brazil South)" y la tabla de subprocesadores lista Brazil South
  para LATAM. Con el despliegue en West US 2 eso deja de ser cierto, y es un
  documento con efecto legal (está enlazado desde `/legal/subprocessors` y el
  DPA). Actualizarlo **antes** del corte, no después.
