-- Ponderación entre autoevaluación y telemetría, elegible por tenant (MEJ-08).
--
-- Hasta ahora la política estaba fija en el código: la respuesta del equipo
-- siempre mandaba sobre su dominio y la telemetría quedaba de contraste. Es la
-- lectura correcta del modelo Crawl-Walk-Run de la FinOps Foundation, pero no
-- sirve para todos: un cliente auditado quiere que pese la EVIDENCIA, y un
-- equipo en fase de adopción quiere que pese su propia lectura.
--
-- VA EN `Tenants` Y NO EN `TenantGlobalSettings`, que es donde parecería
-- corresponder por nombre. `TenantGlobalSettings` es una tabla abandonada: tiene
-- 0 filas y NADA en la app la escribe. Sus cuatro columnas están duplicadas en
-- `Tenants`, que es la que el producto realmente usa:
--
--     TenantGlobalSettings (muerta)      Tenants (viva)
--     theme_preference                   theme_preference      <- saveThemePreference
--     organization_display_name          company_name          <- superAdminTenants
--     custom_logo_blob_url               logo_stored_name
--     is_master_notifications_enabled    notifications_enabled
--
-- Poner la política en la tabla muerta la habría dejado imposible de setear, que
-- es justo el problema que esta mejora viene a resolver.
--
-- El default reproduce exactamente el comportamiento anterior, así que ningún
-- tenant existente ve cambiar su radar por esta migración.
ALTER TABLE Tenants
  ADD COLUMN maturity_score_policy ENUM('self_assessment','telemetry','blended_50_50')
  NOT NULL DEFAULT 'self_assessment';
