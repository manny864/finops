-- Migration: 20260927-003-report-subscriptions.sql
-- MEJ-35 — suscripciones a reportes: cualquier reporte, a la cadencia que elija
-- el usuario.
--
-- Hoy las dos entregas programadas son fijas y de un solo tipo: el export FOCUS
-- diario y el reporte ejecutivo. Un dueño de centro de costo no tiene forma de
-- decir "mandame el desvío de mi grupo los lunes", y en una herramienta de
-- FinOps el reporte que hay que ir a buscar no se mira.
--
-- `last_sent_at` ES LA IDEMPOTENCIA, y por eso no es un campo informativo. El
-- cron corre cada hora: una suscripción semanal lo ve 168 veces por semana. Se
-- manda sólo si `last_sent_at` es anterior al comienzo del período vigente, así
-- que la primera corrida del lunes manda y las otras 23 no.
--
-- LA CADENCIA SE GUARDA DESARMADA (frecuencia + día), no como una expresión
-- cron. Un cron string es más expresivo de lo que esta pantalla ofrece y abre
-- la puerta a valores que la UI no puede mostrar ni editar; además habría que
-- validar la expresión y decidir qué hacer con una inválida ya guardada.

CREATE TABLE IF NOT EXISTS ReportSubscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    -- COLLATE explícito, por lo mismo que en 20260926-001.
    tenant_id VARCHAR(255) NOT NULL COLLATE utf8mb4_unicode_ci,
    report_type VARCHAR(64) NOT NULL,
    -- A qué se suscribe: suscripción de Azure, Cost Group o Perspective+grupo.
    -- JSON y no columnas porque cada tipo de reporte acota distinto, y una
    -- columna por dimensión quedaría casi siempre en NULL.
    scope_json JSON NULL,
    recipients_json JSON NOT NULL,
    frequency ENUM('daily','weekly','monthly') NOT NULL,
    -- 0=domingo .. 6=sábado, igual que `Date.getDay()`, para no traducir.
    day_of_week TINYINT NULL,
    -- 1..31. Un 31 en febrero NO se saltea el mes: se recorta al último día.
    -- Sin eso, una suscripción "el 31" no se manda nunca en los meses cortos y
    -- el usuario no se entera de que no llega.
    day_of_month TINYINT NULL,
    last_sent_at DATETIME NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    -- COLLATE explícito, y acá NO es por una FK: `created_by` se compara con
    -- `Users.email` en el LEFT JOIN del cron (criterio 4, cancelar la
    -- suscripción de alguien dado de baja). `Users.email` es utf8mb4_unicode_ci
    -- y una tabla nueva en MySQL 8 nace utf8mb4_0900_ai_ci, así que sin esto el
    -- JOIN muere con "Illegal mix of collations" (ERROR 1267) -- en el cron, en
    -- producción, y no al desplegar. Verificado contra MySQL real: sin el
    -- COLLATE la consulta del cron no corre.
    created_by VARCHAR(320) NULL COLLATE utf8mb4_unicode_ci,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_repsub_tenant FOREIGN KEY (tenant_id) REFERENCES Tenants (tenant_id) ON DELETE CASCADE,
    KEY idx_repsub_activas (active, tenant_id)
);
