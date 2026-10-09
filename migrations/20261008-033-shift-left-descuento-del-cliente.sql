-- MEJ-20 — Shift-Left FinOps: el descuento del cliente sobre el precio de lista.
--
-- La Retail API publica precios de LISTA. Un cliente con un contrato (EA/MCA),
-- reservas o savings plans paga menos, y un delta de PR a precio de lista suele
-- sobreestimar lo que de verdad va a facturarse. Esta tabla guarda UN porcentaje
-- por tenant que el estimador aplica sobre cada línea; el comentario del PR muestra
-- los dos números (lista y con el descuento) para que no se confunda uno con otro.
--
-- Es un promedio y no el precio real de cada medidor: por eso vive acá, como un
-- valor que el cliente declara, y no se deriva de la facturación (que mezcla
-- reservas puntuales con descuentos permanentes).
--
-- Una fila por tenant; sin fila = sin descuento (0). FK con ON DELETE CASCADE,
-- mismo criterio que el resto de las tablas Iac*: es configuración de un tenant y
-- no tiene por qué sobrevivirlo (lo exige cascadaBorradoTenant.test.ts). Nombre
-- de constraint único en toda la base y colación explícita, por el ER_FK_DUP_NAME
-- / 3780 documentado en 20260914-005.
CREATE TABLE IF NOT EXISTS IacPricingSettings (
    tenant_id VARCHAR(255) NOT NULL PRIMARY KEY,

    -- DECIMAL y no FLOAT: 12.50 % tiene que dar siempre el mismo delta.
    discount_pct DECIMAL(5, 2) NOT NULL DEFAULT 0.00,

    updated_by VARCHAR(255) NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_iac_pricing_tenant FOREIGN KEY (tenant_id)
        REFERENCES Tenants (tenant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
