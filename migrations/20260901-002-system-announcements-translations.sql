-- MEJ-11 (continuación): mostrar el anuncio en el idioma activo de la página.
--
-- `title`/`message` siguen siendo el contenido en el idioma BASE (`es`, el
-- defaultLocale de src/i18n/routing.ts) y no se migran: la fila que ya existe
-- sigue funcionando tal cual, y ese par de columnas es el fallback cuando el
-- idioma pedido no tiene traducción.
--
-- Las traducciones van en UNA columna JSON, no en 6 columnas
-- (title_en/message_en/title_pt/...): agregar un idioma nuevo no requeriría
-- migración, y es el mismo criterio que ya usa `target_tenant_ids` en esta
-- misma tabla.
--
-- Forma: {"en": {"title": "...", "message": "..."}, "pt-BR": {...}}
--
-- OPCIONAL a propósito: un aviso de caída a las 3am tiene que poder publicarse
-- con un solo idioma. Exigir las 3 traducciones convertiría la urgencia en
-- fricción, y el fallback al idioma base es mejor que no mostrar nada.
ALTER TABLE SystemAnnouncements
    ADD COLUMN translations JSON NULL AFTER message;
