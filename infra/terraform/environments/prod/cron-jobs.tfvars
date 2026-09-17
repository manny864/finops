# ---------------------------------------------------------------------------
# cron_jobs — FUENTE DE VERDAD, versionada en git.
#
# Por que este archivo existe y no vive dentro de terraform.tfvars:
#
# terraform.tfvars de prod esta gitignored y se materializa en el runner desde
# el secret TF_VARS_PROD (ver .github/workflows/terraform.yml). Eso sirve para
# los GUIDs y los tamanos de infra, pero para los cron es un problema: son
# configuracion pura, cambian seguido y necesitan revision en PR. Mientras
# estuvieron adentro del secret nadie podia ver el valor real y el .example
# derivo del valor aplicado -- asi fue como cuatro jobs terminaron compartiendo
# el minuto :00 y saturando Azure Cost Management con 429 (2026-09-16).
#
# COMO GANA ESTE ARCHIVO
#
# Terraform aplica los -var-file en el ORDEN de la linea de comando y el
# ULTIMO gana para una misma variable. El workflow corre:
#
#   terraform plan -var-file=terraform.tfvars -var-file=cron-jobs.tfvars
#
# Asi que el cron_jobs que quede en el secret es irrelevante: este lo pisa
# entero (el override es por variable completa, no un merge por clave). No
# hace falta editar el secret para cambiar un horario.
#
# NO renombrar a *.auto.tfvars: los auto.tfvars se cargan ANTES que los
# -var-file de la linea de comando, con lo cual el secret volveria a ganar.
#
# REGLA AL EDITAR: LOS PREWARM NO COMPARTEN MINUTO. Todos pegan a Cost
# Management, que throttlea con facilidad. Escribir la lista de minutos
# explicita ("7,27,47") en vez de "*/20": el modulo desplaza la HORA a UTC
# pero NUNCA el minuto (modules/cronjobs/main.tf:34), asi que el minuto que se
# escribe aca es el minuto real de ejecucion, y "*/20" cae en 0, 20 y 40 --
# justo los que ya usan prewarm-dashboard, prewarm-compute y prewarm-databases.
# ---------------------------------------------------------------------------
cron_jobs = {
  # Snapshot diario de costos. Es el job crítico: si no corre, quedan tablas
  # de costo vacías (incidentes 2026-07-05 y 2026-07-18).
  #
  # async_poll = true (2026-07-30): con 2+ tenants el barrido supera los ~240s
  # que tolera el ingress de Container Apps antes de devolver 504 "stream
  # timeout" — un techo de plataforma, no configurable. Sin esto el job queda
  # marcado Failed en Azure (y dispara la alerta todos los días) aunque el sync
  # complete bien del lado del servidor. Ver el comentario grande al principio
  # de src/app/api/cron/sync/route.ts.
  sync = { cron = "0 3 * * *", timeout_seconds = 3600, async_poll = true } # 06:00 UTC

  # Pre-warm diario completo (Auditorías KQL, Zombies, Whiteboard, Costos MTD/Históricos, Inventario).
  prewarm-daily = { cron = "0 4 * * *", timeout_seconds = 1800, async_poll = true } # 07:00 UTC

  # Pre-warm del dashboard (cache hard-TTL = 15 min).
  #
  # async_poll = true (2026-08-29): mismo techo de ~240s del ingress que en
  # `sync` — con más de un puñado de tenants el barrido serial (2 endpoints
  # ARM pesados por tenant) lo supera y Azure marca la ejecución Failed
  # (bandeja de alertas llena) aunque el barrido complete bien del lado del
  # servidor. Ver el comentario grande en src/app/api/cron/prewarm-dashboard/route.ts.
  #
  # LOS PREWARM NO COMPARTEN MINUTO. Todos consultan Cost Management, que
  # throttlea con facilidad, y `*/N` los hace coincidir: con tres en `*/30` los
  # tres arrancan juntos a las :00 y a las :30. Verificado en prod el
  # 2026-09-15, y peor de lo que parece --el job reporta Succeeded a los 30 s
  # porque solo dispara el HTTP, mientras el trabajo real sigue corriendo dentro
  # del web app varios minutos--. Se declara la lista de minutos explicita
  # (`0,30`) en vez de `*/30` para poder repartirlos.
  prewarm-dashboard = { cron = "0,30 * * * *", timeout_seconds = 1800, async_poll = true }

  # Pre-warm de bases de datos (cache versionada + redis metrics).
  prewarm-databases = { cron = "10,40 * * * *", timeout_seconds = 1800, async_poll = true }

  # Pre-warm de cómputo (workloads).
  prewarm-compute = { cron = "20,50 * * * *", timeout_seconds = 1800, async_poll = true }

  # Pre-warm dedicado del cockpit FinOps/CMP de MySQL.
  prewarm-mysql-finops = { cron = "15 * * * *", timeout_seconds = 300 }

  # Pre-warm dedicado del cockpit FinOps/CMP de Cosmos DB.
  prewarm-cosmos-finops = { cron = "25 * * * *", timeout_seconds = 300 }

  # Pre-warm dedicado del cockpit FinOps/CMP de MongoDB.
  prewarm-mongo-finops = { cron = "35 * * * *", timeout_seconds = 300 }

  # Pre-warm dedicado del cockpit FinOps/CMP de Azure SQL / MI.
  prewarm-sql-finops = { cron = "45 * * * *", timeout_seconds = 300 }

  # Pre-warm dedicado del cockpit FinOps/CMP de PostgreSQL.
  prewarm-postgres-finops = { cron = "55 * * * *", timeout_seconds = 300 }

  # Pre-warm dedicado de cockpits FinOps/CMP de Almacenamiento.
  #
  # 7,27,47 y no `*/20` (2026-09-16). `*/20` cae en 0, 20 y 40 — los tres
  # minutos que ya ocupan prewarm-dashboard (0,30), prewarm-compute (20,50) y
  # prewarm-databases (10,40). La regla de "los prewarm no comparten minuto"
  # que está documentada más arriba se había aplicado sólo a los tres jobs con
  # lista explícita; los cuatro que quedaron en `*/N` volvían a apilarse encima.
  # El módulo desplaza la HORA a UTC pero nunca el minuto (cronjobs/main.tf:34),
  # así que el minuto que se escribe acá es el minuto real de ejecución.
  prewarm-storage-finops = { cron = "7,27,47 * * * *", timeout_seconds = 300 }

  # Pre-warm dedicado del módulo de Seguridad (Defender + familias de costo).
  sync-azure-ai = {
    cron            = "13,33,53 * * * *" # cada 20 min, repartido (ver nota arriba)
    timeout_seconds = 300
    auth_mode       = "header"
    name            = "sync-azure-ai"
    async_poll      = false
  }
  prewarm-security-finops = { cron = "19,39,59 * * * *", timeout_seconds = 300 }

  # Apagado programado de VMs. Ventana de ejecución = 8 min, por eso */2.
  power-schedules = { cron = "*/2 * * * *", timeout_seconds = 120 }

  # Detección de anomalías (Z-Score). Comparte cache Redis de 6h con el
  # endpoint on-demand, así que no multiplica llamadas a Azure.
  #
  # async_poll = true (2026-09-05): el barrido supera los ~240 s del ingress de
  # Container Apps cuando expira el cache de 6h y hay que ir a Cost Management.
  # timeout_seconds sube de 300 a 900 junto con async_poll: el runner sondea
  # hasta timeout-30s, o sea que con 300 habría cortado a los 270, apenas por
  # encima del mismo techo de 240 s que estamos evitando.
  #
  # */30 y no */5 (2026-09-07, objetivo O1.1). El cache es de 6 h: cada 5 min
  # eran 8.640 corridas al mes para refrescar algo que cambia 4 veces por día,
  # y como el timeout (900 s) era el triple del intervalo (300 s), podía haber
  # TRES ejecuciones sondeando el mismo barrido, cada una con su contenedor.
  # A */30 son 1.440 y siguen siendo 12x más frecuentes que el dato.
  #
  # 1,31 y no `*/30` (2026-09-16): `*/30` cae en 0 y 30, que son los dos
  # minutos de prewarm-dashboard. Misma cadencia, sin pisarlo.
  anomaly-detection = { cron = "1,31 * * * *", timeout_seconds = 900, async_poll = true }

  # Alerta si el sync diario no dejó datos frescos. 2h después de sync.
  cost-sync-staleness-check = { cron = "0 5 * * *" } # 08:00 UTC

  # Backfill de huecos históricos (upsert-only), todos los tenants activos.
  # async_poll = true por el mismo motivo que `sync`: el ingress de Container
  # Apps corta a los ~240 s con 504 "stream timeout" (techo de plataforma, no
  # configurable), así que un backfill largo dejaba el job marcado Failed —y
  # disparando la alerta— aunque del lado del servidor terminara bien. Es el
  # síntoma de "falla pero después se recupera".
  #
  # Se vuelve obligatorio con el relleno día por día: cada día faltante es una
  # tanda de consultas más una pausa (GAP_BACKFILL_PACE_MS en la Container App,
  # 2500 ms por defecto), así que 15 huecos ya superan los 240 s.
  historical-gap-backfill = { cron = "0 0 * * *", timeout_seconds = 3600, async_poll = true } # 03:00 UTC

  # Open Data del FinOps Toolkit — semanal, lunes.
  open-data = { cron = "0 1 * * 1", timeout_seconds = 1800 } # lunes 04:00 UTC

  # Retención de adjuntos de soporte (60 días).
  support-attachments-cleanup = { cron = "0 2 * * *" } # 05:00 UTC

  # App Registrations por vencer.
  credential-expiry-alerts = { cron = "0 4 * * *" } # 07:00 UTC

  # Entornos efímeros por vencer/vencidos.
  ttl-expiry-alerts = { cron = "0 6 * * *" } # 09:00 UTC

  # Corta acceso a tenants CANCELED con período pagado vencido.
  subscription-expiry = { cron = "30 3 * * *" } # 06:30 UTC

  # Vence trials cuyo trial_ends_at ya pasó.
  trial-expiry = { cron = "0 22 * * *" } # 01:00 UTC del día siguiente

  # Export FOCUS 1.1 diario por email.
  focus-export-daily = { cron = "0 4 * * *", timeout_seconds = 1800 } # 07:00 UTC

  # Alimenta /api/status y /status. Autentica por query param, no por header.
  status-snapshot = { cron = "*/5 * * * *", timeout_seconds = 120, auth_mode = "query" }
}

