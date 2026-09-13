-- Ponderación entre autoevaluación y telemetría, elegible por tenant (MEJ-08).
--
-- Hasta ahora la política estaba fija en el código: la respuesta del equipo
-- siempre mandaba sobre su dominio y la telemetría quedaba de contraste. Es la
-- lectura correcta del modelo Crawl-Walk-Run de la FinOps Foundation, pero no
-- sirve para todos: un cliente auditado quiere que pese la EVIDENCIA, y un
-- equipo en fase de adopción quiere que pese su propia lectura.
--
-- El default reproduce exactamente el comportamiento anterior, así que ningún
-- tenant existente ve cambiar su radar por esta migración.
ALTER TABLE TenantGlobalSettings
  ADD COLUMN maturity_score_policy ENUM('self_assessment','telemetry','blended_50_50')
  NOT NULL DEFAULT 'self_assessment';
