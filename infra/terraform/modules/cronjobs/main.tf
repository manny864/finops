# Los 14 procesos periódicos de FinOps, como Container Apps Jobs.
#
# Esto es el motivo principal de la migración. Hoy viven en el crontab manual
# del VPS, que NO está en git: el README documenta dos incidentes en los que un
# job estuvo ausente del crontab real mientras la documentación decía que
# corría, y tres tablas de costo quedaron vacías durante semanas sin ningún
# error visible. Acá el schedule es código, viaja con el repo y se revisa en PR.
#
# Los endpoints /api/cron/* se quedan DENTRO de la app: comparten el pool de
# MySQL, los servicios de negocio y los guards de requestAuth. El job sólo hace
# la llamada HTTP autenticada — no duplica lógica (que es lo que pasaría si se
# reescribieran como Azure Functions).
#
# ZONA HORARIA — Container Apps interpreta el cron SIEMPRE en UTC; no hay campo
# de timezone en el schedule. Como los horarios de este producto se piensan en
# hora de Argentina (el snapshot diario "a las 6" es a las 6 de acá), las
# expresiones se declaran en hora local y este módulo las convierte a UTC.
#
# La conversión es segura porque Argentina NO aplica horario de verano desde
# 2009: el offset es -03:00 todo el año. Si alguna vez volviera el DST, esto
# hay que rehacerlo con una tabla de fechas — un offset fijo dejaría de servir.
locals {
  offset_hours = var.timezone_offset_hours

  # Cada expresión se parte en sus 5 campos y se corre sólo el de la hora.
  parsed = {
    for k, v in var.jobs : k => {
      fields = split(" ", trimspace(v.cron))
    }
  }

  shifted = {
    for k, v in var.jobs : k => join(" ", [
      local.parsed[k].fields[0],
      # Hora "*" (los jobs de cada N minutos) no se toca: correr cada 2 min es
      # cada 2 min en cualquier huso.
      local.parsed[k].fields[1] == "*" ? "*" : tostring(
        (tonumber(local.parsed[k].fields[1]) - local.offset_hours + 24) % 24
      ),
      local.parsed[k].fields[2],
      local.parsed[k].fields[3],
      local.parsed[k].fields[4],
    ])
  }

  # Un job semanal o mensual cuya hora cruza la medianoche al convertir a UTC
  # también cambia de día, y el campo de día NO se ajusta acá. En vez de
  # correr el lunes a las 01:00 UTC cuando se pidió el domingo a las 22:00
  # local, el apply falla y se corrige a mano.
  # try() es necesario acá y no cosmético: `&&` en HCL no da cortocircuito
  # real contra errores dentro de un `for...if` — Terraform igual intenta
  # evaluar tonumber(fields[1]) para los jobs donde fields[1] SÍ es "*" (los de
  # cada N minutos, ej. "*/10 * * * *"), y tonumber("*") revienta con "Invalid
  # function argument" en terraform plan. Confirmado en CI el 2026-07-30: el
  # guard `fields[1] != "*"` de la izquierda no evitaba el crash de la derecha.
  # try() hace exactamente lo que el guard pretendía: si tonumber() no puede
  # convertir, el job no es hora-específica y por definición no puede haber
  # rollover de día — cae a false en vez de propagar el error.
  day_rollovers = [
    for k, v in var.jobs : k
    if local.parsed[k].fields[1] != "*"
    && (local.parsed[k].fields[4] != "*" || local.parsed[k].fields[2] != "*" || local.parsed[k].fields[3] != "*")
    && try(tonumber(local.parsed[k].fields[1]) - local.offset_hours >= 24, false)
  ]
}

resource "terraform_data" "no_day_rollover" {
  lifecycle {
    precondition {
      condition     = length(local.day_rollovers) == 0
      error_message = "Estos jobs cambian de día al pasar a UTC y el campo de día no se ajusta solo: ${join(", ", local.day_rollovers)}. Escribir la expresión directamente en UTC y anotarlo."
    }
  }
}

locals {
  # Un fetch autenticado y salida distinta de cero si el endpoint no responde
  # 2xx: así el job queda en Failed en Azure y dispara la alerta.
  runner = <<-JS
    const url = process.env.CRON_URL;
    const secret = process.env.CRON_SECRET;
    const useQuery = process.env.CRON_AUTH_MODE === 'query';
    const target = useQuery ? `$${url}?secret=$${encodeURIComponent(secret)}` : url;
    const headers = useQuery ? {} : { Authorization: `Bearer $${secret}` };
    const started = Date.now();
    fetch(target, { headers, signal: AbortSignal.timeout(Number(process.env.CRON_TIMEOUT_MS || 540000)) })
      .then(async (r) => {
        const body = await r.text().catch(() => '');
        console.log(JSON.stringify({ job: process.env.CRON_JOB, status: r.status, ms: Date.now() - started, body: body.slice(0, 500) }));
        process.exit(r.ok ? 0 : 1);
      })
      .catch((e) => {
        console.error(JSON.stringify({ job: process.env.CRON_JOB, error: String(e), ms: Date.now() - started }));
        process.exit(1);
      });
  JS

  # Variante para jobs con `async_poll = true` (ver variables.tf). El endpoint
  # dispara el trabajo en background y responde de inmediato; este runner hace
  # polling con `?status=1` en requests cortas — ninguna se acerca al techo de
  # ~240s del ingress, porque cada una es sólo una lectura de Redis.
  runner_async = <<-JS
    const url = process.env.CRON_URL;
    const secret = process.env.CRON_SECRET;
    const useQuery = process.env.CRON_AUTH_MODE === 'query';
    const headers = useQuery ? {} : { Authorization: `Bearer $${secret}` };
    const withQs = (extra) => {
      const qs = [useQuery ? `secret=$${encodeURIComponent(secret)}` : '', extra].filter(Boolean).join('&');
      return qs ? `$${url}?$${qs}` : url;
    };
    const pollIntervalMs = Number(process.env.CRON_POLL_INTERVAL_MS || 15000);
    const overallTimeoutMs = Number(process.env.CRON_TIMEOUT_MS || 540000);
    // FUNCIÓN, no constante. AbortSignal.timeout() arranca a contar en el
    // momento en que se CREA (no cuando se usa) y es de un solo disparo:
    // cuando vence queda abortado para siempre. Con un único objeto reusado en
    // todos los fetch, a los 30s de arrancar el job el signal moría y TODOS los
    // polls siguientes rechazaban al instante con TimeoutError sin llegar a
    // tocar la red — el job quedaba dando vueltas hasta agotar CRON_TIMEOUT_MS
    // (59 min) y salía con código 1, marcando cron-sync como Failed en Azure
    // aunque el barrido hubiera terminado bien a los ~5 minutos.
    //
    // Cómo se identificó (prod, 2026-07-30): los fallos de poll aparecían en el
    // log cada ~15s, o sea exactamente pollIntervalMs. Si el fetch estuviera
    // esperando de verdad su timeout de red, el intervalo sería ~45s
    // (15s de sleep + 30s de timeout). Rechazaban en 0ms.
    const shortTimeout = () => ({ signal: AbortSignal.timeout(30000) });
    // Cortar antes si el polling está roto de raíz (DNS, auth, ingress caído):
    // sin esto, un endpoint inalcanzable mantiene el job vivo ~1h antes de
    // reportar nada. 20 fallos seguidos ≈ 5 min sin una sola respuesta válida,
    // holgado para blips de red o de Redis, pero muy por debajo del barrido.
    const maxConsecutiveFailures = 20;
    let consecutiveFailures = 0;
    const started = Date.now();
    (async () => {
      try {
        // Un fallo/timeout ACÁ (ej. cold start del contenedor tardando más de
        // 30s en responder) NO significa que el servidor no haya recibido el
        // request — el endpoint dispara el trabajo en background ANTES de
        // responder, así que puede seguir corriendo del lado del servidor
        // aunque este fetch nunca vea la respuesta. Abortar acá (como hacía
        // antes) marcaba el job Failed en Azure con el barrido completando
        // bien igual — confirmado en prod el 2026-07-30. Se avisa y se sigue
        // al polling, que es lo único que puede confirmar el estado real.
        await fetch(withQs(''), { headers, ...shortTimeout() }).catch((e) => {
          console.warn(JSON.stringify({ job: process.env.CRON_JOB, warn: 'trigger sin respuesta, se sigue con polling', error: String(e) }));
        });
        while (Date.now() - started < overallTimeoutMs) {
          await new Promise((r) => setTimeout(r, pollIntervalMs));
          let status;
          try {
            const r = await fetch(withQs('status=1'), { headers, ...shortTimeout() });
            status = await r.json();
          } catch (e) {
            // Un poll individual que falla (blip de red) no debe tirar todo el
            // barrido: se reintenta en el próximo intervalo mientras quede
            // presupuesto de overallTimeoutMs.
            consecutiveFailures++;
            console.warn(JSON.stringify({ job: process.env.CRON_JOB, warn: 'poll falló, reintenta', consecutiveFailures, error: String(e) }));
            if (consecutiveFailures >= maxConsecutiveFailures) {
              console.error(JSON.stringify({ job: process.env.CRON_JOB, error: 'polling roto: ' + consecutiveFailures + ' fallos seguidos, se corta', ms: Date.now() - started }));
              process.exit(1);
            }
            continue;
          }
          consecutiveFailures = 0;
          if (status.done) {
            console.log(JSON.stringify({ job: process.env.CRON_JOB, status: status.ok ? 200 : 500, ms: Date.now() - started, body: JSON.stringify(status).slice(0, 500) }));
            process.exit(status.ok ? 0 : 1);
          }
        }
        console.error(JSON.stringify({ job: process.env.CRON_JOB, error: 'poll timeout sin done', ms: Date.now() - started }));
        process.exit(1);
      } catch (e) {
        console.error(JSON.stringify({ job: process.env.CRON_JOB, error: String(e), ms: Date.now() - started }));
        process.exit(1);
      }
    })();
  JS
}

resource "azurerm_container_app_job" "this" {
  for_each = var.jobs

  # Los jobs NO siguen la convención larga y no es un descuido: Container Apps
  # limita el nombre a 32 caracteres, y "cscs-finops-prod-eastus2-" ya consume
  # 25 — con endpoints como "support-attachments-cleanup" (27) no hay forma.
  # Se usa "cron-<endpoint>", que además deja el nombre del endpoint legible en
  # el portal. El resource group ya identifica proyecto, ambiente y región.
  name                         = coalesce(each.value.name, "cron-${each.key}")
  resource_group_name          = var.resource_group_name
  location                     = var.location
  container_app_environment_id = var.environment_id
  # Margen sobre el timeout del fetch: si el endpoint cuelga, corta el job.
  replica_timeout_in_seconds = each.value.timeout_seconds
  # Sin reintento automático: estos endpoints son idempotentes pero pesados
  # (llaman a las ARM APIs de Azure, que ya throttlean con 429). Reintentar a
  # ciegas empeora el throttling; el próximo tick del schedule reintenta solo.
  replica_retry_limit = 0
  tags                = var.tags

  depends_on = [terraform_data.no_day_rollover]

  schedule_trigger_config {
    # Convertida a UTC desde la hora local declarada en el tfvars.
    cron_expression          = local.shifted[each.key]
    parallelism              = 1
    replica_completion_count = 1
  }

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_id]
  }

  registry {
    server   = var.registry_server
    identity = var.identity_id
  }

  secret {
    name                = "cron-secret"
    identity            = var.identity_id
    key_vault_secret_id = var.cron_secret_id
  }

  template {
    container {
      name   = each.key
      image  = "${var.registry_server}/${var.image_name}:${var.image_tag}"
      cpu    = 1.0
      memory = "2Gi"
      # No corre la app: sólo dispara el endpoint (o lo dispara y hace polling,
      # ver runner_async / async_poll en variables.tf). Estandarizado a 1.0
      # vCPU / 2Gi para todos los cron jobs (directiva 2026-08-13).
      command = each.value.async_poll ? ["node", "-e", local.runner_async] : ["node", "-e", local.runner]

      env {
        name  = "CRON_JOB"
        value = each.key
      }

      env {
        name  = "CRON_URL"
        value = "${var.app_url}/api/cron/${each.key}"
      }

      env {
        name = "CRON_AUTH_MODE"
        # status-snapshot autentica por query param, no por header.
        value = each.value.auth_mode
      }

      env {
        name  = "CRON_TIMEOUT_MS"
        value = tostring(each.value.timeout_seconds * 1000 - 30000)
      }

      # Sólo lo usa runner_async (async_poll = true); el runner simple lo ignora.
      env {
        name  = "CRON_POLL_INTERVAL_MS"
        value = "15000"
      }

      env {
        name        = "CRON_SECRET"
        secret_name = "cron-secret"
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }
}

# Una alerta por fallo de job, al mismo action group que el resto. Reemplaza a
# los pings de healthchecks.io: el dead-man switch deja de hacer falta cuando
# el scheduler es el propio Azure y reporta ejecuciones fallidas.
resource "azurerm_monitor_metric_alert" "job_failed" {
  # Igual que en security_policy: el for_each no puede depender de
  # action_group_id, que no se conoce hasta el apply.
  for_each = var.alerts_enabled ? var.jobs : {}

  name                = "${var.name_base}-cron-${each.key}-alert"
  resource_group_name = var.resource_group_name
  scopes              = [azurerm_container_app_job.this[each.key].id]
  description         = "El job ${each.key} falló."
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT30M"

  # Nombres verificados 2026-07-28 contra
  #   az monitor metrics list-definitions --resource <job>
  # La métrica es "Executions" (no "JobExecutionCount", que no existe: Azure
  # devolvía 400 "Couldn't find a metric named JobExecutionCount") y la
  # dimensión es "state" en minúscula (no "Status").
  criteria {
    metric_namespace = "Microsoft.App/jobs"
    metric_name      = "Executions"
    aggregation      = "Total"
    operator         = "GreaterThan"
    threshold        = 0

    dimension {
      name     = "state"
      operator = "Include"
      values   = ["Failed"]
    }
  }

  action {
    action_group_id = var.action_group_id
  }

  tags = var.tags
}
