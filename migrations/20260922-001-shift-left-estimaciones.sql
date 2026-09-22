-- MEJ-20 — Shift-Left FinOps: historial de estimaciones de costo por PR.
--
-- Cada fila es una corrida del PR Cost Estimator: un `terraform plan` que entró
-- por POST /api/v1/shift-left/estimate y el delta mensual que se calculó.
--
-- APPEND-ONLY, una fila por corrida y no un upsert por PR. Un PR se re-estima en
-- cada push, y la evolución del delta a lo largo de la revisión ES el dato
-- interesante: muestra si el autor corrigió el sobredimensionamiento después del
-- primer comentario. Un upsert dejaría sólo la última y borraría justamente eso.
--
-- CON FOREIGN KEY Y ON DELETE CASCADE. Se escribió primero sin ella, por miedo al
-- error 3780 que documenta la migración 20260914-005 (una FK a Tenants abortando
-- un CREATE TABLE en bases con otra colación, que además bloquea las migraciones
-- siguientes porque ese fallo no es idempotente para el runner). El test
-- `cascadaBorradoTenant.test.ts` lo rechazó, y tiene razón: sin la FK estas filas
-- sobreviven a la baja del tenant y quedan inalcanzables, con nombres de repo,
-- autores y cifras adentro. Las excepciones que ese test admite son todas cosas
-- que DEBEN sobrevivir --bitácoras de auditoría, evidencia legal, cumplimiento--
-- y una bitácora de estimaciones no es ninguna.
--
-- El riesgo de colación se maneja como en `Commissions`: colación explícita en la
-- tabla y un nombre de constraint único en toda la BASE (en InnoDB los nombres de
-- constraint no son únicos por tabla sino por base, y repetir uno mata el CREATE
-- TABLE con ER_FK_DUP_NAME).
--
-- Los montos van en DECIMAL(12,4) igual que en el resto del repo. Son
-- estimaciones, no cobros, pero mezclarlas con FLOAT en un JOIN con tablas de
-- costo real arrastra el error de coma flotante a un reporte.
CREATE TABLE IF NOT EXISTS IacCostEstimations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,

    -- De dónde vino. `repository` en formato owner/repo; `pr_number` es NULL
    -- cuando se estima una rama o un plan suelto desde la CLI, que es un uso
    -- legítimo y no un dato faltante.
    repository VARCHAR(255) NOT NULL,
    pr_number INT UNSIGNED NULL,
    commit_sha VARCHAR(64) NULL,
    author VARCHAR(255) NULL,

    current_monthly_cost_usd DECIMAL(12, 4) NOT NULL DEFAULT 0,
    projected_monthly_cost_usd DECIMAL(12, 4) NOT NULL DEFAULT 0,
    delta_cost_usd DECIMAL(12, 4) NOT NULL DEFAULT 0,

    -- Cuántos recursos se pudieron tarifar y cuántos no. Sin esto, un delta de
    -- +$12 no se distingue de un delta de +$12 al que le faltaron nueve recursos
    -- sin precio: el número se lee igual y significa cosas muy distintas.
    resources_priced SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    resources_unpriced SMALLINT UNSIGNED NOT NULL DEFAULT 0,

    -- Resultado del Budget Gate. 'NOT_EVALUATED' es el estado por defecto y no
    -- un error: mientras no haya umbral configurado para el repo, la estimación
    -- se informa pero no bloquea nada.
    gate_status ENUM('NOT_EVALUATED', 'OK', 'EXCEEDED') NOT NULL DEFAULT 'NOT_EVALUATED',

    -- El desglose por recurso, para poder reconstruir el comentario del PR sin
    -- volver a pedirle el plan a nadie.
    detail_json JSON NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    KEY idx_iac_tenant_fecha (tenant_id, created_at),
    KEY idx_iac_pr (tenant_id, repository, pr_number),

    CONSTRAINT fk_iac_estimation_tenant FOREIGN KEY (tenant_id)
        REFERENCES Tenants (tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
