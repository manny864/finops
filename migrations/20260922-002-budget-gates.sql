-- MEJ-20 — Budget Gates administrables: umbral de costo por repositorio.
--
-- Hasta acá el umbral vivía en el workflow de cada repo (`threshold-usd` de la
-- GitHub Action). Funciona, pero no se administra: para saber qué umbral tiene
-- cada repo hay que abrir cada `.github/workflows/`, y para cambiarlo hay que
-- mandar un PR al repo que justamente se quiere gobernar. El input de la Action
-- se mantiene y GANA sobre esto: un equipo puede ser más estricto que la
-- plataforma en su propio pipeline, pero no más laxo.
--
-- UNA FILA POR (tenant, repo), con UNIQUE. La tabla de estimaciones de al lado
-- es append-only porque su valor es la evolución; ésta es configuración y su
-- valor es el estado actual, así que es un upsert.
--
-- Sin fila = sin gate. El `gate_status` de `IacCostEstimations` queda en
-- 'NOT_EVALUATED', que es informar y no bloquear. Arrancar con un default
-- implícito bloquearía PRs de gente que nunca pidió un gate.
--
-- FK con ON DELETE CASCADE, mismo criterio que `IacCostEstimations`: es config
-- de un tenant y no tiene por qué sobrevivirlo. Nombre de constraint único en
-- toda la base (en InnoDB no son únicos por tabla) y colación explícita, que es
-- lo que evita el ER_FK_DUP_NAME / 3780 documentado en 20260914-005.
CREATE TABLE IF NOT EXISTS IacBudgetGates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,

    -- Formato owner/repo, igual que `IacCostEstimations.repository` y que
    -- `github.repository` en la Action: se comparan entre sí.
    repository VARCHAR(255) NOT NULL,

    -- El delta mensual, en USD, a partir del cual el PR se marca EXCEEDED.
    -- DECIMAL y no FLOAT: un umbral de 0.50 contra un delta de 0.50 tiene que
    -- resolverse igual siempre.
    threshold_usd DECIMAL(12, 4) NOT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_iac_gate_repo (tenant_id, repository),

    CONSTRAINT fk_iac_gate_tenant FOREIGN KEY (tenant_id)
        REFERENCES Tenants (tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
