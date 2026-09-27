-- Migration: 20260927-002-perspective-cogs.sql
-- MEJ-37 — clasificar un grupo de Perspective como COGS u OpEx.
--
-- TABLA PROPIA Y NO UNA COLUMNA, porque un grupo de Perspective NO ES UNA FILA
-- en ningún lado: existe sólo como el valor `group_name` que repiten las reglas
-- de `PerspectiveRules`. Poner `cogs_classification` ahí obligaría a repetir la
-- misma clasificacion en cada regla del grupo y a resolver qué pasa cuando dos
-- reglas del mismo grupo dicen cosas distintas -- una inconsistencia que la
-- base no podria impedir.
--
-- NO HAY FILA "UNCLASSIFIED". Un grupo sin fila ya está sin clasificar, y
-- guardar explícitamente "no sé" sólo agrega una forma más de decir lo mismo.
-- El endpoint lo reporta igual: el criterio 3 pide que UNCLASSIFIED se VEA,
-- porque un split que no suma el total no sirve para calcular margen.

CREATE TABLE IF NOT EXISTS PerspectiveGroupClassification (
    id INT AUTO_INCREMENT PRIMARY KEY,
    -- COLLATE explícito, por lo mismo que en 20260926-001 y 20260927-001.
    tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci,
    perspective_id INT NOT NULL,
    group_name VARCHAR(120) NOT NULL,
    classification ENUM('COGS','OPEX') NOT NULL,
    classified_by VARCHAR(320) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_pgc_tenant FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE,
    -- Si se borra la Perspective, sus grupos dejan de existir y la
    -- clasificación no tiene a qué referirse.
    CONSTRAINT fk_pgc_perspective FOREIGN KEY (perspective_id) REFERENCES Perspectives (id) ON DELETE CASCADE,
    UNIQUE KEY uq_pgc_grupo (tenant_id, perspective_id, group_name)
);
