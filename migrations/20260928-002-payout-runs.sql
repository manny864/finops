-- Corridas de pago: agrupar lo exigible por beneficiario en un lote.
--
-- EL PROBLEMA QUE RESUELVE
-- Hasta ahora se marcaban comisiones sueltas como pagadas, cada una con su
-- `payment_reference`. Pero una transferencia real le paga a UNA persona el
-- total de N comisiones: pegar el mismo comprobante en las N filas a mano no
-- deja registro de que fueron un solo movimiento, y no hay dónde aplicar un
-- umbral mínimo ni de dónde sacar la orden de pago.
--
-- POR QUÉ NO HAY TABLA DE LÍNEAS
-- La línea de una corrida —cuánto le toca a cada beneficiario— es
-- `SUM(commission_amount) GROUP BY beneficiary` sobre las comisiones que la
-- corrida tomó. Guardarla además sería un total que puede divergir de sus
-- sumandos, y el primer reembolso que ajuste una comisión lo haría divergir.
-- Se deriva.
--
-- La referencia externa de cada línea —el comprobante de ESA transferencia—
-- va en el `payment_reference` que ya tiene cada comisión: se escribe igual
-- para todas las de ese beneficiario en esa corrida.
--
-- UNA MONEDA POR CORRIDA. Un lote es un movimiento de fondos y no se puede
-- transferir en dos monedas a la vez. Mezclarlas obligaría a un tipo de cambio
-- que la plataforma no tiene por qué inventar.
CREATE TABLE IF NOT EXISTS PayoutRuns (
    id INT AUTO_INCREMENT PRIMARY KEY,
    currency VARCHAR(3) NOT NULL,

    -- El piso que se aplicó. Se guarda, no se recalcula: cambiar el umbral por
    -- defecto el mes que viene no puede reescribir por qué una corrida vieja
    -- dejó a alguien afuera.
    minimum_amount DECIMAL(12, 4) NOT NULL DEFAULT 0,

    status ENUM('OPEN', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255) NOT NULL,
    paid_at DATETIME NULL,
    paid_by VARCHAR(255) NULL,
    notes TEXT NULL,

    KEY idx_payout_run_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A qué corrida entró cada comisión. NULL = todavía no entró a ninguna.
--
-- Es también el candado: al armar una corrida se toman sólo las que tienen
-- esto en NULL, dentro de una transacción. Sin eso, dos operadores armando
-- corridas a la vez se llevarían las mismas comisiones y se pagaría dos veces.
ALTER TABLE Commissions
  ADD COLUMN payout_run_id INT NULL;

CREATE INDEX idx_commission_payout_run ON Commissions (payout_run_id);

-- ON DELETE SET NULL y no CASCADE: borrar una corrida no puede llevarse las
-- comisiones. Lo que se hace con una corrida que no va es cancelarla, que las
-- libera para la siguiente.
ALTER TABLE Commissions
  ADD CONSTRAINT fk_commission_payout_run
  FOREIGN KEY (payout_run_id) REFERENCES PayoutRuns(id) ON DELETE SET NULL;
