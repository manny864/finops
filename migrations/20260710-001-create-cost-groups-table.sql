-- 20260710-001-create-cost-groups-table.sql
-- Metadata de "Cost Groups" (agrupación de costo por Business Unit, hoy
-- identificada por el tag CostCenter en CostSnapshots — ver
-- getTop5CostGroups en src/app/api/intelligence/whiteboard/route.ts).
--
-- El budget mensual YA vive en la tabla `Budgets` (keyed por
-- tenant_id + cost_center_tag_value, ver 20260705-002-create-budgets-table.sql)
-- y se sigue usando desde ahí (no se duplica aquí) para no romper
-- /api/budgets, /api/budgets/alerts, /api/budgets/burn, MCP y el feed de Power BI.
--
-- Esta tabla sólo agrega lo que faltaba: description, owner y auditoría
-- de creación, para la nueva pantalla "Cost Groups" (lectura, sin CRUD aún).
-- Idempotente: IF NOT EXISTS. FK a Tenants y a Users en paridad con el resto.
CREATE TABLE IF NOT EXISTS CostGroups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description VARCHAR(1000) NULL,
    owner_user_id INT NULL,
    created_by VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cost_group_tenant_name (tenant_id, name),
    INDEX idx_cost_groups_tenant (tenant_id),
    FOREIGN KEY (tenant_id) REFERENCES Tenants(tenant_id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id) REFERENCES Users(id) ON DELETE SET NULL
);
