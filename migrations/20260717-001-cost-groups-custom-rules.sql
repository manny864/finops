-- Cost Groups hoy solo se "descubren" automáticamente por el valor del tag
-- CostCenter en CostSnapshots (lectura pura, sin CRUD) — pero el manual de
-- usuario prometía poder CREAR un grupo con una regla propia (por patrón de
-- nombre de Resource Group o por un tag arbitrario) y ajustar manualmente
-- qué entra. Esta migración agrega lo necesario para que esa promesa sea real.
--
-- match_type NULL = grupo legacy, sigue derivándose 100% del tag CostCenter
-- (comportamiento sin cambios). match_type seteado = grupo creado por el
-- usuario, con una regla propia.
ALTER TABLE CostGroups
    ADD COLUMN match_type ENUM('tag', 'name_pattern') NULL AFTER description,
    ADD COLUMN match_tag_key VARCHAR(255) NULL AFTER match_type,
    ADD COLUMN match_tag_value VARCHAR(255) NULL AFTER match_tag_key,
    ADD COLUMN match_rg_pattern VARCHAR(255) NULL AFTER match_tag_value;

-- Asignación manual de Resource Groups a un Cost Group custom, para ajustar
-- la membresía más allá de lo que capture la regla automática (ej. sumar un
-- RG puntual que no sigue la convención de nombres del patrón, o que no
-- tiene el tag). CostSnapshots no tiene ResourceId poblado para tenants
-- Azure (solo AWS) — el grano manejable de forma confiable es resource_group,
-- no recurso individual, así que la asignación manual opera a ese nivel.
CREATE TABLE IF NOT EXISTS CostGroupResourceGroups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    group_name VARCHAR(255) NOT NULL,
    resource_group VARCHAR(255) NOT NULL,
    assigned_by VARCHAR(255) NULL,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cost_group_rg (tenant_id, group_name, resource_group),
    INDEX idx_cost_group_rg_tenant (tenant_id, group_name),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE
);
