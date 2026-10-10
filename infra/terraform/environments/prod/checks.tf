# ---------------------------------------------------------------------------
# Guardas de configuracion.
#
# Son `check` blocks: emiten WARNING en el plan y en el apply, no bloquean. Se
# eligio warning y no `validation` a proposito, porque una emergencia tiene que
# poder aplicarse igual; lo que no puede pasar es que la condicion se rompa en
# SILENCIO, que es exactamente como llegamos al incidente de 429 del
# 2026-09-16.
# ---------------------------------------------------------------------------

locals {
  # Jobs horarios (hora = "*") que NO pegan a Azure Cost Management: son los
  # unicos que pueden usar "*/N" o compartir minuto. La lista es de EXCLUSION a
  # proposito. Antes era de inclusion (prewarm* mas dos nombres) y
  # report-subscriptions entro el 2026-09-28 en "0 * * * *", el minuto de
  # prewarm-dashboard, sin que este check lo viera: el prewarm empezo a caer en
  # 429 a las 00, 03, 06 y 12 UTC. Un job horario nuevo queda vigilado por
  # defecto; eximirlo es escribirlo aca.
  # azure-api-usage-rollup sólo vuelca contadores a MySQL
  # (volcarUsoApiAzureAMysql) y comparte el minuto 13 con sync-azure-ai, que
  # llega por el tfvars del secret y no está en cron-jobs.tfvars.
  # external-spend-poll (*/5) pega a Document Intelligence.
  sin_cost_management = ["power-schedules", "status-snapshot", "azure-api-usage-rollup", "external-spend-poll"]

  # Los diarios quedan afuera: prewarm-daily es "0 4 * * *" y comparte el minuto
  # 0 con prewarm-dashboard, pero solo coinciden una vez al dia, no cada hora.
  cost_jobs_horarios = {
    for k, v in var.cron_jobs : k => split(" ", v.cron)[0]
    if !contains(local.sin_cost_management, k) && split(" ", v.cron)[1] == "*"
  }

  # "0,30" -> ["0","30"]. El modulo de cronjobs desplaza la HORA a UTC pero
  # nunca el minuto (modules/cronjobs/main.tf), asi que el minuto declarado es
  # el minuto real de ejecucion y se puede comparar tal cual.
  cost_jobs_minutos = flatten([for k, f in local.cost_jobs_horarios : split(",", f)])

  cost_jobs_minutos_repetidos = [
    for m in distinct(local.cost_jobs_minutos) : m
    if length([for x in local.cost_jobs_minutos : x if x == m]) > 1
  ]

  # "*/20" cae en 0, 20 y 40 -- justo los minutos de prewarm-dashboard,
  # prewarm-compute y prewarm-databases. Por eso la regla pide lista explicita.
  cost_jobs_con_wildcard = [
    for k, f in local.cost_jobs_horarios : k if can(regex("\\*", f))
  ]
}

check "prewarm_no_comparten_minuto" {
  assert {
    condition = length(local.cost_jobs_minutos_repetidos) == 0
    error_message = format(
      "Hay jobs horarios contra Cost Management compartiendo minuto: %s. Arrancan juntos y disparan 429 (Too many requests). Repartirlos en environments/prod/cron-jobs.tfvars. Minutos por job: %s",
      join(", ", local.cost_jobs_minutos_repetidos),
      jsonencode(local.cost_jobs_horarios),
    )
  }

  assert {
    condition = length(local.cost_jobs_con_wildcard) == 0
    error_message = format(
      "Estos jobs horarios contra Cost Management usan '*' en el minuto: %s. Un '*/N' apila varios jobs en el mismo minuto. Declarar la lista explicita (ej. \"7,27,47\") en environments/prod/cron-jobs.tfvars.",
      join(", ", local.cost_jobs_con_wildcard),
    )
  }
}

check "replicas_web_acotadas" {
  assert {
    condition = alltrue([for s in var.stamps : s.web_min_replicas >= 0 && s.web_max_replicas >= 1 && s.web_min_replicas <= s.web_max_replicas && floor(s.web_min_replicas) == s.web_min_replicas && floor(s.web_max_replicas) == s.web_max_replicas])
    error_message = format(
      "Configuracion de replicas invalida: %s. Minimo y maximo deben ser enteros, con minimo >= 0, maximo >= 1 y minimo <= maximo. El maximo se configura por stamp, sujeto a los limites y cuotas de Azure.",
      jsonencode({ for k, s in var.stamps : k => { min = s.web_min_replicas, max = s.web_max_replicas } }),
    )
  }
}
