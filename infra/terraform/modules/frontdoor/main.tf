# Front Door: entra en juego cuando existe el SEGUNDO stamp. Con un solo stamp
# Cloudflare ya hace WAF/TLS/CDN gratis y esto sería gasto puro.
#
# Su trabajo acá es geo-routing: mandar a los visitantes europeos al stamp
# europeo desde el primer request, para que no paguen el redirect del
# directorio de tenants.
#
# IMPORTANTE: esto es una OPTIMIZACIÓN, no el mecanismo de cumplimiento. La
# residencia la garantiza la app: cada stamp rechaza tenants que no le
# corresponden y redirige al que sí. Un admin alemán conectándose desde Miami
# tiene que terminar igual en el stamp europeo, y eso Front Door solo no lo
# puede saber.

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
  mode                = "Prevention"

  managed_rule {
    type    = "Microsoft_DefaultRuleSet"
    version = "2.1"
    action  = "Block"
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
      }
    }
  }
}
