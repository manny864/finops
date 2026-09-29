-- Identidad del beneficiario en Payoneer.
--
-- Payoneer no paga a quien no esté registrado en el programa: primero se le
-- genera un enlace de alta, el beneficiario lo completa, y recién ahí su
-- `payee_id` puede recibir plata. Estas columnas guardan ese estado.
--
-- `payoneer_payee_id` ES NUESTRO, no de ellos. La API de Create Registration
-- Link recibe "el identificador único del payee en la plataforma del cliente" y
-- Payoneer lo adopta para las operaciones siguientes. Se guarda igual en vez de
-- derivarlo de `id` en cada llamada: el día que un beneficiario haya que
-- re-registrar con otro identificador —o que se migre desde otro sistema— la
-- columna es el único lugar donde eso se dice.
--
-- EL ESTADO ES NUESTRA COPIA, no la verdad. La verdad vive en Payoneer y llega
-- por webhook. Acá se guarda para poder mostrar en el panel quién falta sin
-- pegarle a la API en cada carga.
--
-- Afiliados y comerciales en paralelo, con las mismas columnas: son el mismo
-- objeto para el rail de pago. Que `Commissions` ya los unifique y estas dos
-- tablas no es deuda vieja, no algo que convenga profundizar acá.
ALTER TABLE Affiliates
  ADD COLUMN payoneer_payee_id VARCHAR(64) NULL,
  ADD COLUMN payoneer_status ENUM('NONE', 'INVITED', 'ACTIVE', 'DECLINED') NOT NULL DEFAULT 'NONE',
  ADD COLUMN payoneer_invited_at DATETIME NULL,
  ADD COLUMN payoneer_linked_at DATETIME NULL;

ALTER TABLE SalesReps
  ADD COLUMN payoneer_payee_id VARCHAR(64) NULL,
  ADD COLUMN payoneer_status ENUM('NONE', 'INVITED', 'ACTIVE', 'DECLINED') NOT NULL DEFAULT 'NONE',
  ADD COLUMN payoneer_invited_at DATETIME NULL,
  ADD COLUMN payoneer_linked_at DATETIME NULL;

-- UNIQUE: dos beneficiarios con el mismo `payee_id` le mandarían la plata de
-- uno a la cuenta del otro. Los NULL no colisionan entre sí en MySQL, así que
-- esto no estorba a quien todavía no se registró.
CREATE UNIQUE INDEX uq_affiliate_payoneer_payee ON Affiliates (payoneer_payee_id);
CREATE UNIQUE INDEX uq_sales_rep_payoneer_payee ON SalesReps (payoneer_payee_id);
