-- Nuevo tipo de regla de alerta: 'idle_resources'.
--
-- La detección de recursos ociosos es lo más completo que tiene la plataforma
-- --unas 20 reglas KQL contra Resource Graph: discos sin adjuntar, IPs públicas
-- sin asociar, NICs y NSGs huérfanos, App Service Plans sin sitios, Elastic
-- Pools sin bases, VNets y subredes vacías, snapshots viejos...-- y hasta ahora
-- era 100% PASIVA: el dato está fresco (lo calienta `prewarm-daily`), pero nadie
-- se entera hasta que abre la pantalla.
--
-- Credenciales por vencer y entornos con TTL ya tienen su alerta
-- ('credential_expiry', 'ttl_expiry'); el desperdicio, que es el corazón del
-- producto, no la tenía.
--
-- `threshold_value` es el gasto mensual desperdiciado (USD) a partir del cual
-- avisar, así una cuenta chica no recibe una alerta por dos discos de $3.
ALTER TABLE AlertRules
    MODIFY COLUMN rule_type ENUM('budget','anomaly','forecast','threshold','credential_expiry','ttl_expiry','idle_resources') NOT NULL;
