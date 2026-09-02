-- MEJ-30 paso 2: el desglose de costo POR ETIQUETA, para los tenants que no
-- tienen export FOCUS configurado y sólo reciben datos del sync vía Cost
-- Management.
--
-- POR QUÉ UNA TABLA PROPIA Y NO UNA COLUMNA EN CostSnapshots
-- Es la misma decisión que ya tomaron `CostMeterSnapshots` y
-- `CostCategorySnapshots` (ver el comentario en syncTenant: "Mismo costo, dos
-- desgloses ... a su propia tabla para no duplicar sumas"). El corte por
-- etiqueta es EL MISMO dinero que las filas de chargeback de `CostSnapshots`,
-- visto por otra dimensión: si conviviera en la misma tabla, todo consumidor
-- que suma `CostSnapshots` sin filtrar contaría el gasto dos veces.
--
-- `CostSnapshots.allocation_tag_hash` existe y forma parte de su clave única
-- justamente para admitir filas particionadas por etiqueta, pero HOY ningún
-- consumidor lo filtra (verificado: la columna no aparece en un solo WHERE de
-- src/). Poblarlo sin antes hacer grano-consciente a cada consulta duplicaría
-- las sumas en silencio, que es la peor forma de romper un número de costos.
-- Cuando esas consultas se vuelvan grano-conscientes, esta tabla puede
-- colapsarse ahí adentro.
--
-- POR QUÉ NO HAY ServiceName
-- La Query API de Cost Management admite como máximo 2 agrupaciones. Para
-- traer la etiqueta hay que gastar una en `TagKey`, así que queda una sola
-- para dimensión: se elige `ResourceGroupName`, que es por donde matchean las
-- reglas de Cost Groups. El desglose por servicio ya lo cubre `CostSnapshots`.
--
-- Sin FOREIGN KEY a Tenants: la colación de `Tenants.tenant_id` difiere entre
-- entornos y un error 3780 aborta el CREATE TABLE, dejando trabada toda la
-- corrida de migraciones.
CREATE TABLE IF NOT EXISTS CostTagSnapshots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(100) NOT NULL,
    subscription_id VARCHAR(100) NOT NULL DEFAULT 'default',
    date DATE NOT NULL,
    resource_group VARCHAR(100) NOT NULL DEFAULT '*',
    -- La CLAVE de la etiqueta (ej. 'CostCenter'), no el par entero: cada fila
    -- es el costo de un valor de esa clave.
    tag_key VARCHAR(255) NOT NULL,
    -- El VALOR. Cadena vacía = el recurso no lleva esa etiqueta, que es un
    -- dato en sí: es el gasto sin asignar de esa dimensión.
    tag_value VARCHAR(512) NOT NULL DEFAULT '',
    cost_usd DECIMAL(12,4) NOT NULL,
    currency VARCHAR(10) DEFAULT 'USD',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- El valor va HASHEADO en la clave única: los valores de etiqueta los
    -- escribe el cliente y no tienen cota de longitud, así que un `Project` de
    -- 400 caracteres haría superar el límite de 3072 bytes de InnoDB y el
    -- INSERT fallaría con datos perfectamente válidos. Mismo razonamiento que
    -- `allocation_tag_hash` en CostSnapshots.
    tag_value_hash VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    UNIQUE KEY unique_tenant_date_sub_rg_tag (tenant_id, subscription_id, date, resource_group, tag_key, tag_value_hash),
    INDEX idx_tag_lookup (tenant_id, tag_key, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
