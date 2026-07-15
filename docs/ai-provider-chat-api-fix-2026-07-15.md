# Fix: DeepSeek y Azure OpenAI usaban la Responses API (404 Not Found) — 2026-07-15

## Síntoma

En **Administración → IA (Configuración Global)** (`/admin/ai-config-global`), tras
cargar una API key de **DeepSeek** y pulsar **"Probar conexión"**, el test fallaba
siempre. Los logs del contenedor de producción mostraban:

```
[admin/config/ai-global/test] error: Not Found
```

## Causa raíz

El AI SDK (`@ai-sdk/openai` y `@ai-sdk/azure`, v3) cambió el comportamiento por
defecto: cuando el provider se invoca **directamente como función** —
`deepseek('deepseek-chat')`, `azure('gpt-4o')` — el modelo resultante apunta a la
**Responses API** de OpenAI (`/responses`), no a **Chat Completions**
(`/chat/completions`).

- **DeepSeek** solo implementa `/chat/completions`. La llamada pegaba contra
  `https://api.deepseek.com/v1/responses`, que no existe → **404 Not Found**.
- **Azure OpenAI** tiene Responses API, pero requiere una `apiVersion` reciente y
  un deployment habilitado que **muchos recursos no tienen**. Un deployment
  estándar de Chat Completions llamado `gpt-4o` daría el mismo 404 contra
  `/openai/v1/responses`.

**OpenAI real no está afectado**: su Responses API es nativa y soporta `gpt-4o`
sin problema, así que la llamada directa funciona — se deja como está.

## Fix

Pedir explícitamente `.chat(...)` para forzar el endpoint de Chat Completions en
los providers OpenAI-compatibles que no soportan la Responses API:

```ts
// DeepSeek
return deepseek.chat('deepseek-chat');   // → /v1/chat/completions

// Azure OpenAI
return azure.chat('gpt-4o');             // → /openai/v1/chat/completions
```

Aplicado en los **dos** lugares que construyen el modelo:

- `src/modules/core/aiProvider.ts` (`AIProviderFactory.getGeminiModel`, usado por
  el Copilot y el evaluador de anomalías).
- `src/services/aiService.ts` (`generateFinOpsReport`, usado por el Reporte
  Ejecutivo).

## Verificación

Verificado **en local** antes de desplegar, interceptando `fetch` para capturar la
URL de destino sin necesitar una key real:

| Provider | Llamada vieja (bare) | Llamada nueva (`.chat`) |
|---|---|---|
| DeepSeek | `https://api.deepseek.com/v1/responses` ❌ | `.../v1/chat/completions` ✅ |
| Azure    | `https://<res>.openai.azure.com/openai/v1/responses` ❌ | `.../openai/v1/chat/completions` ✅ |

`npx tsc --noEmit`, `vitest run` (558 tests) y `next build` en verde.

## Commits

- `de226fb` — fix DeepSeek
- `3119fd2` — fix Azure OpenAI (misma clase de bug, aplicado defensivamente)
