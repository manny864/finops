-- Migration: 20260927-001-saved-views.sql
-- MEJ-38 — vistas guardadas. La mitad de COMODIDAD de la mejora.
--
-- Es lo contrario de `UserScopes`, y por eso son dos tablas y no una: una vista
-- es algo que el usuario ELIGE y puede dejar de elegir; un alcance es algo que
-- le asignaron y no puede quitarse. Guardarlas juntas invitaría a que un dia
-- alguien "aplique" una vista como si fuera permiso.
--
-- EL DUEÑO SE GUARDA COMO CADENA VACIA, NO COMO NULL, y no es un capricho: en
-- MySQL un UNIQUE deja pasar todos los NULL que quieras porque NULL != NULL, y
-- `UNIQUE (tenant_id, user_email, name)` con NULL para las compartidas
-- permitiria diez vistas compartidas llamadas "Q3". Es el mismo NULL != NULL
-- que ya obligo a envolver en COALESCE el predicado de alcance de MEJ-34.
-- Con '' la restriccion hace lo que dice.
--
-- `is_default` no lleva restriccion en la base: "a lo sumo una en true por
-- usuario" no se expresa con un UNIQUE comun, y un trigger para esto seria mas
-- caro de mantener que la unica escritura que lo toca. Lo garantiza el endpoint,
-- que apaga las demas en la misma transaccion.

CREATE TABLE IF NOT EXISTS SavedViews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    -- COLLATE explicito por lo mismo que en 20260926-001: `Tenants.tenant_id`
    -- es utf8mb4_unicode_ci y una base nueva con MySQL 8 usa utf8mb4_0900_ai_ci,
    -- con lo cual la FK falla con "Referencing column ... are incompatible".
    tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci,
    -- '' = compartida con todo el tenant. Ver el comentario de arriba.
    user_email VARCHAR(320) NOT NULL DEFAULT '',
    name VARCHAR(120) NOT NULL,
    -- NULL = la vista no fija Perspective y sólo guarda filtros.
    perspective_id INT NULL,
    -- NULL = "cualquier grupo de esta Perspective", igual que en UserScopes.
    group_name VARCHAR(120) NULL,
    filters_json JSON NULL,
    is_default TINYINT(1) NOT NULL DEFAULT 0,
    created_by VARCHAR(320) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_savedview_tenant FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE,
    -- Si se borra la Perspective, la vista que la nombraba no resuelve nada.
    CONSTRAINT fk_savedview_perspective FOREIGN KEY (perspective_id) REFERENCES Perspectives (id) ON DELETE CASCADE,
    UNIQUE KEY uq_savedview_owner_name (tenant_id, user_email, name),
    KEY idx_savedview_tenant (tenant_id)
);
