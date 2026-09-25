-- Migration: 20260925-001-perspectives.sql
-- MEJ-34 — Perspectives: agrupar el gasto por N dimensiones a la vez.
--
-- Hoy un Cost Group es UNA dimension: el valor del tag `CostCenter`. Una
-- Perspective es un conjunto ORDENADO de reglas; la primera que matchea decide
-- el grupo del recurso, y por eso la pertenencia dentro de una Perspective es
-- unica sin pedirle al usuario que resuelva conflictos a mano. El mismo recurso
-- puede estar en grupos de Perspectives distintas.
--
-- SIN TABLA DE ASIGNACION MATERIALIZADA, a proposito. Materializar obliga a
-- recalcular todo ante cada cambio de regla y a decidir que pasa con el
-- historico -- una discusion que no hace falta tener --. La pertenencia se
-- evalua al consultar, sobre el agregado que `CostSnapshots` ya guarda.

CREATE TABLE IF NOT EXISTS Perspectives (
    id INT AUTO_INCREMENT PRIMARY KEY,
    -- COLLATE explicito: `Tenants.tenant_id` es utf8mb4_unicode_ci y una base
    -- creada desde cero con MySQL 8 usa utf8mb4_0900_ai_ci por defecto, con lo
    -- cual la FK falla con "Referencing column ... are incompatible". Es la
    -- misma trampa que obligo a la migracion 20260909-002 a MODIFY una decena de
    -- tablas. Comprobado contra el MySQL local, que reprodujo el error.
    tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_perspective_tenant FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE,
    -- Dos Perspectives con el mismo nombre en el mismo tenant no se pueden
    -- distinguir en el selector transversal.
    UNIQUE KEY uq_perspective_tenant_name (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS PerspectiveRules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    perspective_id INT NOT NULL,
    -- El grupo al que cae el recurso si esta regla matchea. Se repite entre
    -- reglas a proposito: un grupo puede juntarse por varios criterios.
    group_name VARCHAR(120) NOT NULL,
    match_type ENUM('tag','name_pattern','subscription','resource_group','resource_type') NOT NULL,
    -- Solo para `tag`: la CLAVE de la etiqueta. En el resto va NULL.
    match_key VARCHAR(255) NULL,
    match_value VARCHAR(512) NOT NULL,
    -- El orden ES la semantica: define que regla gana. Sin el, la pertenencia
    -- unica no seria determinista.
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_rule_perspective FOREIGN KEY (perspective_id) REFERENCES Perspectives (id) ON DELETE CASCADE,
    INDEX idx_rule_perspective_orden (perspective_id, sort_order)
);
