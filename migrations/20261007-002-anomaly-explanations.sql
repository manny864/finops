-- Propuesta de IA, Fase 1b: explicación con IA de una anomalía.
--
-- Una fila por anomalía, idioma y hash de lo que vio el modelo (hechos ya
-- redactados + versión del prompt): si los hechos cambian, se genera otra.
-- source = 'template' guarda una salida rechazada por los validadores, con el
-- motivo en explanation_json, para no volver a pagar por los mismos hechos.
--
-- Sin tenant_id, a diferencia de la propuesta: el tenant se alcanza por
-- Anomalies, que ya cuelga de Tenants con ON DELETE CASCADE. Una columna
-- tenant_id exigiría su propia FK a Tenants (cascadaBorradoTenant.test) para
-- repetir un dato que la fila padre ya tiene.

CREATE TABLE IF NOT EXISTS AnomalyExplanations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    anomaly_id INT NOT NULL,
    locale VARCHAR(10) NOT NULL,
    facts_hash CHAR(64) CHARACTER SET ascii NOT NULL,
    explanation_json JSON NOT NULL,
    source ENUM('ai', 'template') NOT NULL,
    model_name VARCHAR(100) NULL,
    feedback ENUM('up', 'down') NULL,
    feedback_by VARCHAR(320) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_anomaly_explanations (anomaly_id, locale, facts_hash),

    CONSTRAINT fk_anomaly_explanations_anomaly
        FOREIGN KEY (anomaly_id) REFERENCES Anomalies(id) ON DELETE CASCADE
);
