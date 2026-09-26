-- Migration: 20260926-001-user-scopes.sql
-- MEJ-38 — el alcance como PERMISO, no como filtro.
--
-- Una fila acá deja de ser una preferencia y pasa a ser un recorte que el
-- usuario no puede quitarse: las rutas le sirven su porcion o no le sirven
-- nada. Sin fila, el usuario ve exactamente lo que ve hoy -- que es lo que
-- hace seguro el despliegue.
--
-- UNA FILA POR USUARIO, a proposito. Una Perspective ya asigna cada recurso a
-- exactamente UN grupo (la primera regla que matchea gana), asi que
-- Perspective + grupo es la unidad natural. Con varias filas "su porcion"
-- pasaria a ser la union, y habria que decidir sobre que base se calculan los
-- porcentajes. Levantar el UNIQUE mas adelante es una migracion y un OR en el
-- predicado; bajarlo despues de haber permitido varias, no.
--
-- NI ADMIN NI OWNER pueden tener alcance, y la razon es concreta: emitir una
-- clave de API -- MCP o publica -- exige uno de esos dos roles, y una clave es
-- por TENANT, no por usuario. Un Admin acotado se saltearia su propio recorte
-- emitiendose una clave. La restriccion se aplica en el endpoint que asigna
-- (`/api/admin/user-scopes`) porque MySQL no puede mirar otra tabla desde un
-- CHECK.

CREATE TABLE IF NOT EXISTS UserScopes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    -- COLLATE explicito por lo mismo que en 20260925-001: `Tenants.tenant_id`
    -- es utf8mb4_unicode_ci y una base creada desde cero con MySQL 8 usa
    -- utf8mb4_0900_ai_ci, con lo cual la FK falla con "Referencing column ...
    -- are incompatible".
    tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci,
    -- El email y no el `entra_oid`: es lo que el Admin escribe al asignar, y es
    -- la clave por la que `requireTenantRole` ya busca en `Users`.
    user_email VARCHAR(320) NOT NULL,
    perspective_id INT NOT NULL,
    -- NULL = "cualquier grupo de esta Perspective", que no es lo mismo que no
    -- acotar: deja afuera lo que ninguna regla asigna. Es el mismo criterio que
    -- `filtroDeAlcance` ya usa para el selector transversal.
    group_name VARCHAR(120) NULL,
    assigned_by VARCHAR(320) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_userscope_tenant FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE,
    -- Si se borra la Perspective, el recorte deja de existir: mejor que el
    -- usuario recupere la vista completa a que quede con un alcance colgado que
    -- no resuelve y le niegue todo.
    CONSTRAINT fk_userscope_perspective FOREIGN KEY (perspective_id) REFERENCES Perspectives (id) ON DELETE CASCADE,
    UNIQUE KEY uq_userscope_tenant_email (tenant_id, user_email)
);
