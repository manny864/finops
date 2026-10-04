-- MEJ-16, criterio 3 — registro de avisos de vencimiento de reservas.
--
-- Una fila por (reserva, vencimiento, escalón) avisado. Es lo que hace que
-- cada escalón —90, 60 y 30 días— se avise UNA vez aunque el cron corra todos
-- los días, y que una corrida perdida se recupere en la siguiente: el cron
-- compara contra lo anotado y no contra "hoy faltan exactamente 90".
--
-- `expiry_date` va en la clave a propósito: si la reserva se renueva o se
-- extiende, la fecha cambia y la escalera vuelve a empezar.
CREATE TABLE IF NOT EXISTS ReservationExpiryNotices (
    -- COLLATE explícito por la FK, igual que en 20260927-003.
    tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci,
    reservation_id VARCHAR(64) NOT NULL,
    expiry_date DATE NOT NULL,
    threshold_days SMALLINT NOT NULL,
    notified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, reservation_id, expiry_date, threshold_days),
    CONSTRAINT fk_resexp_tenant FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE
);
