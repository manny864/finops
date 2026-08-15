-- Descontinúa el tier Essential (colapsado en Professional, ver PricingPage.tsx
-- y src/lib/tierLogic.ts). Idempotente: el UPDATE no hace nada si ya no quedan
-- tenants en Essential, y el MODIFY COLUMN redefine el ENUM al mismo valor si
-- se corre más de una vez.

-- 1. Migrar cualquier tenant existente en Essential a Professional (más
--    features, sin downgrade de acceso para el cliente).
UPDATE Tenants SET tier = 'Professional' WHERE tier = 'Essential';

-- 2. Angostar el ENUM: 'Essential' deja de ser un valor válido para altas
--    nuevas. DEFAULT pasa a 'Professional' (nuevo piso de la plataforma).
ALTER TABLE Tenants
    MODIFY COLUMN tier ENUM('Professional', 'Business', 'Enterprise') DEFAULT 'Professional';
