-- MEJ-11: Módulo de comunicaciones globales a usuarios (SuperAdmin).
--
-- Alcance de esta migración: 2 canales (banner + popup), sin la integración
-- con el panel de notificaciones del tenant (canal 3 de la propuesta original)
-- -- ese canal auto-genera alertas por tenant desde reglas de gasto/auditoría
-- (ver TenantNotifications), un mecanismo distinto a un anuncio administrado
-- por un humano con ventana de vigencia y alcance elegible. Mezclarlos habría
-- forzado una abstracción que no encaja en ninguno de los dos lados.
--
-- `status` sólo tiene 3 valores reales -- 'draft' | 'published' | 'cancelled'.
-- NO se guardan 'scheduled'/'active'/'finished' como filas separadas: esos son
-- derivables de `starts_at`/`ends_at` contra NOW() en el momento de leer, así
-- que materializarlos exigiría un cron que los mantenga sincronizados sin
-- ganar nada -- la consulta "¿está activo?" es la misma cuenta.
--
-- Sin FK a Tenants(tenant_id) a propósito, mismo motivo que
-- TenantExcludedSubscriptions (20260829-001): la colación de esa columna
-- difiere entre entornos según cuándo se creó la base, y una FK incompatible
-- aborta el CREATE TABLE con el error 3780 -- no idempotente para el runner,
-- bloquea TODAS las migraciones siguientes.
CREATE TABLE IF NOT EXISTS SystemAnnouncements (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    severity ENUM('info','maintenance','warning','critical') NOT NULL DEFAULT 'info',
    channels SET('banner','popup') NOT NULL DEFAULT 'banner',
    -- Alcance: TRUE = todos los tenants. FALSE = sólo los listados en
    -- target_tenant_ids (JSON array de tenant_id). Se resuelve en JS al leer
    -- las filas candidatas por ventana de fecha, no con un JOIN: evita una
    -- tabla de vínculos más y el mismo problema de colación de arriba.
    target_all_tenants BOOLEAN NOT NULL DEFAULT TRUE,
    target_tenant_ids JSON NULL,
    action_url VARCHAR(500) NULL,
    starts_at DATETIME NOT NULL,
    ends_at DATETIME NOT NULL,
    status ENUM('draft','published','cancelled') NOT NULL DEFAULT 'draft',
    created_by_email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status_window (status, starts_at, ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sólo trackea el canal popup (es el único que la propuesta pide "no volver a
-- mostrar" de forma persistente). El banner se colapsa por sesión
-- (sessionStorage, sin fila acá) y desaparece solo al vencer `ends_at`.
CREATE TABLE IF NOT EXISTS UserAnnouncementDismissals (
    announcement_id BIGINT NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    dismissed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (announcement_id, user_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
