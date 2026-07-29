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
  revision_mode                = "Single"
  tags                         = var.tags

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

  dynamic "secret" {
    for_each = var.inline_secrets
    content {
      name  = secret.key
      value = secret.value
    }
  }

  ingress {
    external_enabled = true
    target_port      = var.target_port
    transport        = "auto"

    traffic_weight {
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
        transport     = "HTTP"
        port          = var.target_port
        path          = "/api/health"
        initial_delay = 20
      }

      # Sin readiness, Container Apps manda tráfico a una réplica que todavía
      # está hidratando secretos desde Key Vault en instrumentation.ts.
      readiness_probe {
        transport = "HTTP"
        port      = var.target_port
        path      = "/api/health"
      }
    }
  }

  lifecycle {
    # El tag de imagen lo mueve el pipeline de deploy, no Terraform.
    ignore_changes = [template[0].container[0].image]
  }
}
