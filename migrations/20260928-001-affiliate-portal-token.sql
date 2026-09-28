-- Enlace de panel del afiliado.
--
-- POR QUÉ UN ENLACE Y NO UNA CUENTA
-- Un afiliado no es usuario de ningún tenant y no tiene identidad en nuestro
-- Entra ID: darle un panel por la vía normal significaba construirle alta,
-- contraseña, recuperación y sesiones — un sistema de autenticación entero,
-- con su superficie de ataque, para una pantalla de sólo lectura.
--
-- Se reusa el patrón zero-knowledge que ya está andando en
-- `publicApiKey.service.ts`: se genera un token de 32 bytes, se guarda SÓLO su
-- SHA-256, y el texto plano se muestra UNA vez al emitirlo. El enlace ES la
-- credencial, así que se trata como tal: se puede revocar, y se registra
-- cuándo se usó por última vez.
--
-- `portal_token_prefix` existe para poder decir en la UI de qué enlace se
-- habla ("afp_live_3f2c…") sin poder reconstruirlo, igual que con las claves
-- de API.
ALTER TABLE Affiliates
  ADD COLUMN portal_token_hash CHAR(64) NULL,
  ADD COLUMN portal_token_prefix VARCHAR(20) NULL,
  ADD COLUMN portal_token_issued_at DATETIME NULL,
  ADD COLUMN portal_token_last_used_at DATETIME NULL;

-- La búsqueda del panel entra por el hash: es la consulta de cada request del
-- afiliado y no puede ser un scan de la tabla. UNIQUE además de índice porque
-- dos afiliados con el mismo hash sería una colisión de SHA-256 o un bug de
-- copiado, y en los dos casos hay que enterarse acá y no en producción.
CREATE UNIQUE INDEX uq_affiliate_portal_token ON Affiliates (portal_token_hash);
