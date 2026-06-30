# MCP (Model Context Protocol) Server (Feature F)

## Tier asignado
**Pro+** (integraciones con agentes IA y workflows externos son feature avanzada).

## Qué resuelve
Toolkit MS recomienda exponer datos FinOps a herramientas externas. Acá implementamos un **bridge HTTP compatible con MCP** que permite a Claude Desktop, Copilot, ChatGPT/GPTs custom y cualquier agente IA consultar el FinOps SaaS con API keys tenant-scoped y sólo lectura.

## Endpoint principal
`POST /api/mcp` — JSON-RPC 2.0, compatible con la spec MCP `2024-11-05`.

### Métodos
- `initialize` → devuelve capabilities + serverInfo
- `tools/list` → lista las 5 tools disponibles con su JSON Schema
- `tools/call` → ejecuta una tool, devuelve `content: [{type:"text", text: <json>}]`

### Tools

| Tool | Input | Output |
|---|---|---|
| `get_cost_summary` | `{days?}` | total, avg diario, trend %, point count |
| `get_top_resources` | `{limit?}` | top N resource_id por costo 30d |
| `get_zombie_resources` | `{}` | discos/recursos huérfanos pendientes |
| `get_recommendations` | `{limit?}` | rightsizing/RI/schedule abiertas |
| `get_budget_status` | `{}` | % consumido por budget activo |

### Auth
Header `Authorization: Bearer mcp_<32hex>`. Key hash sha256 contra `MCPApiKeys (tenant_id, key_hash, ...)`.

### Schema (`migrations/20260629-005-mcp-keys.sql`)
```sql
MCPApiKeys (id, tenant_id, key_prefix, key_hash, label, created_by_email,
            created_at, last_used_at, revoked_at)
```

## Management endpoint
`/api/admin/mcp-keys` (requires `Admin` o `Owner` del tenant):
- `GET ?tenantId=` → lista keys (metadata, no plaintext)
- `POST {tenantId, label}` → crea key, devuelve plaintext UNA VEZ
- `DELETE ?tenantId=&keyId=` → revoca (soft delete)

## Uso desde Claude Desktop

Con un gateway HTTP→stdio como `mcp-bridge` o un wrapper custom:

```json
{
  "mcpServers": {
    "finops-saas": {
      "transport": {
        "type": "http",
        "url": "https://app.cscloudsolutions.com.ar/api/mcp",
        "headers": { "Authorization": "Bearer mcp_xxx" }
      }
    }
  }
}
```

## Uso desde GPT/Copilot custom action

OpenAPI/manifest declara una sola tool POST a `/api/mcp` con JSON-RPC body. El agente IA puede invocar `tools/list` para descubrir capabilities y luego `tools/call` con el name+args.

## Smoke test

```bash
# capabilities (público)
curl http://localhost:3000/api/mcp

# tools/list sin auth
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
# → 401

# con key válida
curl -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer mcp_xxx" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_cost_summary","arguments":{"days":7}},"id":2}'
```

## Seguridad
- Keys son sha256 hashed at-rest, plaintext devuelto SOLO al crear.
- Cada llamada actualiza `last_used_at` (audit trail).
- Tools son **read-only**: no hay mutaciones en MCP. Las mutaciones (apply remediation, etc) siguen requiriendo Entra ID + RBAC.
- `tenant_id` se infiere del key — el caller nunca lo pasa, no hay riesgo de cross-tenant.

## Próximas mejoras (no incluidas)
- Resource Templates (otra primitiva MCP) para exponer reports estructurados.
- Prompts (otra primitiva MCP) para inyectar contexto FinOps a conversaciones.
- Rate limiting por key (Redis counter, 1000 calls/hora).
- WebSocket/SSE para streaming results (cuando MCP spec lo formalice).
- UI en `/admin/mcp-keys` para gestión visual (hoy solo via API).
