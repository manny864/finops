-- 20260705-003 — Amplía Tenants.ai_api_key para almacenar la key de IA cifrada (IA-2).
--
-- La key ahora se guarda cifrada con AES-256-GCM en formato self-contained
-- `enc:v1:<iv>:<authTag>:<ciphertext>` (ver src/lib/secretCrypto.ts). Una key
-- de proveedor típica (~100-200 chars) cifrada supera los 255 chars previos,
-- por eso se amplía a 1024.
--
-- Idempotente: MODIFY COLUMN al mismo tipo es un no-op re-ejecutable; si la
-- tabla no existe aún (instalación nueva), db.ts la crea con el tipo correcto.

ALTER TABLE Tenants MODIFY COLUMN ai_api_key VARCHAR(1024);
