# App web de FinOps sobre Container Apps.
#
# A diferencia del diseño original de App Service, acá corre la imagen Docker
# tal cual (node:22-alpine, `output: standalone`) — el mismo artefacto que hoy
# corre en el VPS, sin build-on-server.
#
# No hay rol "worker": los procesos periódicos de este producto son los 14
# endpoints /api/cron/*, que se disparan con Container Apps Jobs (ver el módulo
# cronjobs). La lógica de negocio se queda dentro de la app, compartiendo el
# pool de MySQL y los guards de requestAuth — no se duplica en Functions.

resource "azurerm_container_app" "this" {
  name                         = "${var.name_base}-web"
  resource_group_name          = var.resource_group_name
  container_app_environment_id = var.environment_id
  # "Multiple" habilita el despliegue por etiquetas: una revisión nueva entra
  # SIN tráfico con la etiqueta `testing`, se valida contra su propio FQDN, y
  # recién cuando se da el OK se promueve intercambiando etiquetas con
  # `produccion`. En "Single" esto es imposible: cada `az containerapp update`
  # se lleva el 100% del tráfico al instante, sin ventana de revisión.
  revision_mode = "Multiple"
  tags          = var.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [var.identity_id]
  }

  registry {
    server   = var.registry_server
    identity = var.identity_id
  }

  # Secrets referenciados desde Key Vault: el valor nunca pasa por el state de
  # Terraform ni queda visible en el portal.
  dynamic "secret" {
    for_each = var.key_vault_secret_ids
    content {
      name                = secret.key
      identity            = var.identity_id
      key_vault_secret_id = secret.value
    }
  }

  # `var.inline_secrets` es sensitive = true (contiene la password de MySQL, la
  # de Redis, connection strings) y Terraform no permite usar un valor
  # sensible directo en for_each: necesita las keys para direccionar cada
  # instancia del recurso, y se niega a hacerlo con datos marcados sensibles.
  # `nonsensitive()` se aplica SÓLO a las keys (nombres estables como
  # "db-password", "redis-password" — ver locals.app_secrets en stamp/main.tf,
  # no son secretas en sí, son las mismas que ya se referencian por nombre en
  # otros lugares del módulo). El valor sigue leyéndose de var.inline_secrets,
  # que sigue marcado sensitive — ningún secreto real se expone.
  dynamic "secret" {
    for_each = nonsensitive(keys(var.inline_secrets))
    content {
      name  = secret.value
      value = var.inline_secrets[secret.value]
    }
  }

  ingress {
    external_enabled = true
    target_port      = var.target_port
    transport        = "auto"

    # Sólo el arranque: deja la primera revisión como `produccion` con todo el
    # tráfico. A partir de ahí el reparto lo maneja el pipeline (etiquetas
    # `produccion`/`testing` y `revision label swap`), por eso este bloque
    # está en `ignore_changes` — si no, cada `terraform apply` devolvería el
    # tráfico a la revisión que figure en el state y desharía una promoción.
    traffic_weight {
      label           = "produccion"
      latest_revision = true
      percentage      = 100
    }

    # Sin esto, cualquiera puede pegarle al origen salteando el WAF de
    # Cloudflare. Vacío = abierto (sólo mientras se valida el certificado del
    # dominio propio).
    dynamic "ip_security_restriction" {
      for_each = var.allowed_ip_ranges
      content {
        name             = "allow-${ip_security_restriction.key}"
        action           = "Allow"
        ip_address_range = ip_security_restriction.value
      }
    }
  }

  template {
    min_replicas = var.min_replicas
    max_replicas = var.max_replicas

    # Escalado por demanda: N requests concurrentes por réplica.
    http_scale_rule {
      name                = "http-concurrency"
      concurrent_requests = tostring(var.concurrent_requests_per_replica)
    }

    container {
      name   = "web"
      image  = "${var.registry_server}/${var.image_name}:${var.image_tag}"
      cpu    = var.cpu
      memory = var.memory

      dynamic "env" {
        for_each = var.env_vars
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.secret_env_vars
        content {
          name        = env.key
          secret_name = env.value
        }
      }

      liveness_probe {
        transport               = "HTTP"
        port                    = var.target_port
        path                    = "/api/health"
        initial_delay           = 30
        interval_seconds        = 15
        timeout                 = 5
        failure_count_threshold = 5
      }

      # Sin readiness, Container Apps manda tráfico a una réplica que todavía
      # está hidratando secretos desde Key Vault en instrumentation.ts.
      readiness_probe {
        transport               = "HTTP"
        port                    = var.target_port
        path                    = "/api/health"
        interval_seconds        = 10
        timeout                 = 5
        failure_count_threshold = 3
      }
    }
  }

  lifecycle {
    # image: el tag lo mueve el pipeline de deploy, no Terraform.
    # workload_profile_name: Azure asigna "Consumption" y lo devuelve en el
    # state; la configuración no lo declara, así que sin esto cada plan quiere
    # ponerlo en null y el apply nunca llega a "No changes". Mismo patrón que
    # infrastructure_resource_group_name en el Container App Environment.
    # traffic_weight: el reparto entre `produccion` y `testing` lo maneja el
    # pipeline (revision label swap). Sin esto, el primer `terraform apply`
    # posterior a una promoción devolvería el 100% a la revisión que figure en
    # el state, deshaciendo el despliegue aprobado.
    ignore_changes = [
      template[0].container[0].image,
      workload_profile_name,
      ingress[0].traffic_weight,
    ]
  }
}
