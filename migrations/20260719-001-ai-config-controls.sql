-- El manual de usuario prometía, en Configuración de IA: habilitar/deshabilitar
-- funciones de IA, elegir modelo (ya existía vía ai_provider/ai_api_key),
-- ajustar sensibilidad de detecciones, y qué datos se comparten. Solo lo
-- segundo existía — esta migración agrega lo necesario para el resto.
--
-- ai_anomaly_sensitivity mapea a un umbral de Z-Score en
-- anomalyDetectionService.ts: low=3.5 (solo picos grandes), medium=2.5
-- (default actual, sin cambios), high=1.5 (más sensible).
--
-- ai_share_resource_names / ai_share_tags controlan si esos campos van
-- redactados antes de enviarse a un proveedor de IA externo (Gemini/OpenAI/
-- Anthropic/etc.) al generar el Reporte Ejecutivo con IA — ver el comentario
-- IA-5 en src/modules/core/aiProvider.ts (docs/security/audit-2026-07-05.md).
ALTER TABLE Tenants
    ADD COLUMN ai_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN ai_anomaly_sensitivity ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium',
    ADD COLUMN ai_share_resource_names BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN ai_share_tags BOOLEAN NOT NULL DEFAULT TRUE;
