# cron_jobs de STAGING: un subconjunto reducido y propio, no el de prod (que es un enlace en el resto
# de los archivos de esta carpeta, pero éste NO). Con web_min_replicas = 0, los 29 jobs de prod
# mantendrían despierta la app las 24 horas y subirían el costo; acá alcanza con los que ejercitan
# el camino cron → app (el que cambia con el NAT y el filtro de origen) y los diarios críticos.
# Los horarios están en hora local (UTC-3), igual que en prod: el módulo los pasa a UTC.
#
# Se pasa como -var-file DESPUÉS de terraform.tfvars, así que gana sobre el cron_jobs del secret.
# status-snapshot autentica por header Authorization (INFRA-01..04, hallazgo L-01): la ruta ya no
# acepta ?secret=. En prod el job sigue en query hasta aplicar Terraform: hacerlo junto con promote-prod.
cron_jobs = {
  sync                        = { cron = "0 3 * * *", timeout_seconds = 3600, async_poll = true }
  prewarm-dashboard           = { cron = "5 12 * * *", timeout_seconds = 1800, async_poll = true }
  support-attachments-cleanup = { cron = "0 2 * * *" }
  ai-cache-purge              = { cron = "20 2 * * *" }
  trial-expiry                = { cron = "0 22 * * *" }
  status-snapshot             = { cron = "0,30 * * * *", timeout_seconds = 120 }
}
