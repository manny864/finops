-- Visibilidad del gasto de IA que paga la propia plataforma (vs BYOK del
-- tenant). Hasta ahora las llamadas a generateText/generateObject en
-- aiService.ts y aiProvider.ts no dejaban ningún rastro de tokens/costo, así
-- que no había forma de saber cuánto gasto de Gemini/Anthropic/Azure OpenAI
-- absorbe la plataforma via la key global de fallback vs las keys propias de
-- cada tenant. Ver docs/vps-infra-improvement-plan.md (línea de gasto propio).
--
-- Idempotente: CREATE TABLE IF NOT EXISTS no falla si ya se corrió antes.

CREATE TABLE IF NOT EXISTS PlatformAiUsage (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id VARCHAR(255) NULL,
    source ENUM('byok', 'platform') NOT NULL,
    provider VARCHAR(50) NOT NULL,
    model_name VARCHAR(100) NOT NULL,
    feature VARCHAR(50) NOT NULL,
    input_tokens INT NOT NULL DEFAULT 0,
    output_tokens INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_platform_ai_source_date (source, created_at),
    INDEX idx_platform_ai_tenant (tenant_id, created_at)
);
