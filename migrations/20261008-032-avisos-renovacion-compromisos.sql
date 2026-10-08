-- Registro de avisos de renovación de Commitments, como
-- ReservationExpiryNotices (20261004-002): una fila por (compromiso, fecha
-- límite, escalón) avisado, para que cada escalón —90, 60 y 30 días— se avise
-- UNA vez aunque el cron corra cada 5 minutos.
--
-- La fecha límite es la de renovación (o fin) menos los días de preaviso.
--
-- Sin tenant_id: cuelga de Commitments, que ya cae en cascada con el tenant.
CREATE TABLE IF NOT EXISTS CommitmentRenewalNotices (
    commitment_id BIGINT NOT NULL,
    deadline DATE NOT NULL,
    threshold_days SMALLINT NOT NULL,
    notified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (commitment_id, deadline, threshold_days),
    CONSTRAINT fk_crn_commitment FOREIGN KEY (commitment_id) REFERENCES Commitments (id) ON DELETE CASCADE
);
