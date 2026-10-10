# Front Door: borde de entrega (WAF, rate limiting, bots) y, con Private Link, el único
# camino público al origen.
#
# Dos usos, ninguno encendido por defecto (frontdoor_enabled = false):
#
#  1. Geo-routing con un SEGUNDO stamp: mandar a los visitantes europeos al stamp europeo
#     desde el primer request, para que no paguen el redirect del directorio de tenants.
#     IMPORTANTE: es una OPTIMIZACIÓN, no el mecanismo de cumplimiento. La residencia la
#     garantiza la app: cada stamp rechaza tenants que no le corresponden y redirige al que
#     sí. Un admin alemán conectándose desde Miami tiene que terminar igual en el stamp
#     europeo, y eso Front Door solo no lo puede saber.
#
#  2. Cerrar el origen de verdad: con origin_private_link el origin se conecta por Private
#     Link al entorno de Container Apps, que entonces puede quedar con el acceso público
#     deshabilitado (stamp: app_private_access_only). Es ALTERNATIVA a la lista de IP de
#     Cloudflare, no se suma: con el acceso público apagado Cloudflare deja de llegar al
#     origen, y el borde pasa a ser este.
#
# Sólo Premium admite Private Link hacia el origin (learn.microsoft.com, "Create a private
# link to an Azure Container App with Azure Front Door") y el ruleset gestionado del WAF.
#
# Después del apply con Private Link hay UN paso manual: aprobar la conexión de endpoint
# privado pendiente en el entorno (Azure puede crear varias solicitudes; aprobar todas las
# que lleven el mensaje de origin_private_link.request_message). Ver el runbook de
# docs/security/endurecimiento-infraestructura-saas-2026-10-09.md.

locals {
  extra_origin_groups = { for s in var.extra_origins : s.key => s }
}

resource "azurerm_cdn_frontdoor_profile" "this" {
  count               = var.enabled ? 1 : 0
  name                = "${var.name_base}-afd"
  resource_group_name = var.resource_group_name
  sku_name            = var.sku_name
  tags                = var.tags
}

resource "azurerm_cdn_frontdoor_endpoint" "this" {
  count                    = var.enabled ? 1 : 0
  name                     = "${var.name_base}-fde"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this[0].id
  tags                     = var.tags
}

# --- origin group por defecto ---
resource "azurerm_cdn_frontdoor_origin_group" "default" {
  count                    = var.enabled ? 1 : 0
  name                     = "og-default"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this[0].id
  session_affinity_enabled = false

  load_balancing {
    sample_size                 = 4
    successful_samples_required = 3
  }

  health_probe {
    path                = "/api/health"
    request_type        = "GET"
    protocol            = "Https"
    interval_in_seconds = 100
  }
}

resource "azurerm_cdn_frontdoor_origin" "default" {
  count                          = var.enabled ? 1 : 0
  name                           = "origin-default"
  cdn_frontdoor_origin_group_id  = azurerm_cdn_frontdoor_origin_group.default[0].id
  enabled                        = true
  host_name                      = var.origin_host_name
  http_port                      = 80
  https_port                     = 443
  origin_host_header             = var.origin_host_name
  priority                       = 1
  weight                         = 1000
  certificate_name_check_enabled = true

  dynamic "private_link" {
    for_each = var.origin_private_link != null ? [var.origin_private_link] : []
    content {
      request_message        = private_link.value.request_message
      target_type            = "managedEnvironments"
      location               = private_link.value.location
      private_link_target_id = private_link.value.target_id
    }
  }

  lifecycle {
    precondition {
      condition     = var.origin_private_link == null || var.sku_name == "Premium_AzureFrontDoor"
      error_message = "El Private Link hacia el origin sólo existe en Front Door Premium (frontdoor_sku = Premium_AzureFrontDoor)."
    }
  }
}

# --- un origin group por stamp adicional (ej. eu) ---
resource "azurerm_cdn_frontdoor_origin_group" "extra" {
  for_each                 = var.enabled ? local.extra_origin_groups : {}
  name                     = "og-${each.key}"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this[0].id
  session_affinity_enabled = false

  load_balancing {
    sample_size                 = 4
    successful_samples_required = 3
  }

  health_probe {
    path                = "/api/health"
    request_type        = "GET"
    protocol            = "Https"
    interval_in_seconds = 100
  }
}

resource "azurerm_cdn_frontdoor_origin" "extra" {
  for_each                       = var.enabled ? local.extra_origin_groups : {}
  name                           = "origin-${each.key}"
  cdn_frontdoor_origin_group_id  = azurerm_cdn_frontdoor_origin_group.extra[each.key].id
  enabled                        = true
  host_name                      = each.value.host_name
  http_port                      = 80
  https_port                     = 443
  origin_host_header             = each.value.host_name
  priority                       = 1
  weight                         = 1000
  certificate_name_check_enabled = true

  dynamic "private_link" {
    for_each = each.value.private_link_target_id != null ? [1] : []
    content {
      request_message        = "AFD Private Link Request"
      target_type            = "managedEnvironments"
      location               = each.value.private_link_location
      private_link_target_id = each.value.private_link_target_id
    }
  }

  lifecycle {
    precondition {
      condition     = each.value.private_link_target_id == null || var.sku_name == "Premium_AzureFrontDoor"
      error_message = "El Private Link hacia el origin sólo existe en Front Door Premium (frontdoor_sku = Premium_AzureFrontDoor)."
    }
  }
}

# --- ruteo ---
resource "azurerm_cdn_frontdoor_rule_set" "geo" {
  count                    = var.enabled && length(local.extra_origin_groups) > 0 ? 1 : 0
  name                     = "georouting"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this[0].id
}

resource "azurerm_cdn_frontdoor_route" "this" {
  count                         = var.enabled ? 1 : 0
  name                          = "route-app"
  cdn_frontdoor_endpoint_id     = azurerm_cdn_frontdoor_endpoint.this[0].id
  cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.default[0].id
  cdn_frontdoor_origin_ids      = [azurerm_cdn_frontdoor_origin.default[0].id]
  cdn_frontdoor_rule_set_ids    = length(local.extra_origin_groups) > 0 ? [azurerm_cdn_frontdoor_rule_set.geo[0].id] : []
  supported_protocols           = ["Http", "Https"]
  patterns_to_match             = ["/*"]
  forwarding_protocol           = "HttpsOnly"
  https_redirect_enabled        = true
  link_to_default_domain        = true

  cdn_frontdoor_custom_domain_ids = var.custom_domain_host_name != "" ? [azurerm_cdn_frontdoor_custom_domain.this[0].id] : []
}

# Dominio propio en Front Door, con certificado gestionado (gratis, lo renueva Front Door).
# Orden obligatorio, con un paso de DNS afuera de Terraform en el medio: ver el runbook.
#  1. Aplicar. Front Door entrega un token de validación (output custom_domain_validation_token).
#  2. Cargar en el DNS el TXT _dnsauth.<subdominio> con ese token. Front Door valida de forma
#     asíncrona (Submitting, Pending y recién Approved).
#  3. Cuando esté Approved, apuntar el CNAME del dominio al endpoint de Front Door.
resource "azurerm_cdn_frontdoor_custom_domain" "this" {
  count                    = var.enabled && var.custom_domain_host_name != "" ? 1 : 0
  name                     = "cd-app"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this[0].id
  host_name                = var.custom_domain_host_name

  tls {
    certificate_type = "ManagedCertificate"
    minimum_version  = "TLS12"
  }
}

resource "azurerm_cdn_frontdoor_custom_domain_association" "this" {
  count                          = var.enabled && var.custom_domain_host_name != "" ? 1 : 0
  cdn_frontdoor_custom_domain_id = azurerm_cdn_frontdoor_custom_domain.this[0].id
  cdn_frontdoor_route_ids        = [azurerm_cdn_frontdoor_route.this[0].id]
}

# Regla de geo-routing: si el request viene de un país de la lista, se sirve
# desde ese stamp.
resource "azurerm_cdn_frontdoor_rule" "geo" {
  for_each                  = var.enabled ? local.extra_origin_groups : {}
  name                      = "route${each.key}"
  cdn_frontdoor_rule_set_id = azurerm_cdn_frontdoor_rule_set.geo[0].id
  order                     = index(keys(local.extra_origin_groups), each.key) + 1
  behavior_on_match         = "Stop"

  conditions {
    remote_address_condition {
      operator     = "GeoMatch"
      match_values = each.value.countries
    }
  }

  actions {
    route_configuration_override_action {
      cdn_frontdoor_origin_group_id = azurerm_cdn_frontdoor_origin_group.extra[each.key].id
      forwarding_protocol           = "HttpsOnly"
    }
  }

  depends_on = [azurerm_cdn_frontdoor_origin.extra]
}

# El ruleset gestionado sólo existe en Premium.
locals {
  waf_enabled = var.enabled && var.sku_name == "Premium_AzureFrontDoor"
}

resource "azurerm_cdn_frontdoor_firewall_policy" "waf" {
  count               = local.waf_enabled ? 1 : 0
  name                = "${var.name_compact}waf"
  resource_group_name = var.resource_group_name
  sku_name            = var.sku_name
  enabled             = true
  mode                = var.waf_mode

  managed_rule {
    type    = "Microsoft_DefaultRuleSet"
    version = "2.1"
    action  = "Block"
  }

  # Protección contra bots administrada (sólo Premium). Con action Log no bloquea: sólo
  # registra. Pasar a Block después de revisar el log del WAF: los logs (WAF, acceso y health
  # probe) ya los manda a Log Analytics module.global_diagnostics del environment.
  dynamic "managed_rule" {
    for_each = var.waf_bot_protection_enabled ? [1] : []
    content {
      type    = "Microsoft_BotManagerRuleSet"
      version = "1.1"
      action  = var.waf_bot_action
    }
  }

  # Límite de pedidos por IP de cliente. Con action Log no corta a nadie: mide. El umbral
  # por defecto (1200 por minuto y por IP) es una estimación sin datos de tráfico: revisar
  # el log antes de pasar la acción a Block. Una pantalla de la app dispara muchas llamadas
  # a /api, así que un umbral bajo bloquearía a usuarios legítimos. El nombre de una regla
  # personalizada sólo admite letras y números.
  dynamic "custom_rule" {
    for_each = var.waf_rate_limit_enabled ? [1] : []
    content {
      name                           = "RateLimitPorIP"
      enabled                        = true
      priority                       = 100
      type                           = "RateLimitRule"
      action                         = var.waf_rate_limit_action
      rate_limit_duration_in_minutes = var.waf_rate_limit_duration_minutes
      rate_limit_threshold           = var.waf_rate_limit_threshold

      match_condition {
        match_variable = "RequestUri"
        operator       = "BeginsWith"
        match_values   = ["/"]
      }
    }
  }
}

# Sin esta security policy el WAF existe pero no está asociado a ningún dominio:
# se crea, se paga y no filtra nada. Es el defecto que la auditoría del paquete
# original marcó como crítico y que este módulo heredó.
resource "azurerm_cdn_frontdoor_security_policy" "waf" {
  count                    = local.waf_enabled ? 1 : 0
  name                     = "${var.name_base}-secpol"
  cdn_frontdoor_profile_id = azurerm_cdn_frontdoor_profile.this[0].id

  security_policies {
    firewall {
      cdn_frontdoor_firewall_policy_id = azurerm_cdn_frontdoor_firewall_policy.waf[0].id

      association {
        patterns_to_match = ["/*"]

        domain {
          cdn_frontdoor_domain_id = azurerm_cdn_frontdoor_endpoint.this[0].id
        }

        dynamic "domain" {
          for_each = var.custom_domain_host_name != "" ? [1] : []
          content {
            cdn_frontdoor_domain_id = azurerm_cdn_frontdoor_custom_domain.this[0].id
          }
        }
      }
    }
  }
}
