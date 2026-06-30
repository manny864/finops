# Power BI Templates (Feature G)

## Tier asignado
**Pro+** (reportes ejecutivos y BI son feature de tiers pagos).

## Qué resuelve
El Microsoft FinOps Toolkit publica reportes Power BI .pbit (Cost Summary, Commitments, etc.). Acá ofrecemos lo equivalente en el SaaS sin distribuir binarios `.pbit`: entregamos los **scripts Power Query M** que el usuario pega en Power BI Desktop, junto con un **feed JSON autenticado** que sirve los datos.

## Por qué no .pbit binario
El formato `.pbit` requiere `DataMashup` encriptado (XML packaged) — generarlo dinámicamente con datos del tenant en runtime es complejo y propenso a fallos de compatibilidad de versiones. La estrategia "Power Query M + feed REST" es la **misma recomendación oficial** de Microsoft para data sources custom (https://learn.microsoft.com/power-query/connectorscertification).

## Endpoints

| Endpoint | Auth | Descripción |
|---|---|---|
| `GET /api/templates/powerbi` | público | Lista los 4 templates con metadata |
| `GET /api/templates/powerbi/[id]` | público | Detalle + script Power Query M |
| `GET /api/templates/powerbi/[id]?format=pq` | público | Download `.pq` (texto plano) |
| `GET /api/exports/powerbi-feed?type=...` | MCP key | Feed JSON tabular para Power BI |

## Templates incluidos

| ID | Nombre | Feed type | Categoría |
|---|---|---|---|
| `cost-overview` | FinOps Cost Overview | `costs` | cost |
| `sustainability` | Sustainability & Carbon | `sustainability` | sustainability |
| `zombies` | Zombie Resources & Waste | `zombies` | governance |
| `budgets` | Budget Tracking | `budgets` | cost |

## Flujo usuario

1. Usuario va a la página de Reports → Power BI Templates en el SaaS (futura UI).
2. Descarga `.pq` del template deseado.
3. Genera una API Key MCP en `/api/admin/mcp-keys` (POST `{tenantId, label:"PowerBI"}`).
4. En Power BI Desktop: **Get Data → Blank Query → Advanced Editor**, pega el script.
5. Reemplaza `<YOUR_BASE_URL>` y `<YOUR_MCP_KEY>`.
6. **Done → Refresh**. Datos cargados como tabla, listos para visualizar.

## Auth del feed
Reusa la misma tabla `MCPApiKeys` que Feature F. El header es `Authorization: Bearer mcp_<key>`. Esto consolida la gestión de keys: una sola key sirve para MCP agents Y Power BI.

## Files

- `src/lib/powerbiTemplates.ts` — registry con 4 templates + scripts M.
- `src/app/api/templates/powerbi/route.ts` — listado.
- `src/app/api/templates/powerbi/[id]/route.ts` — detalle/download.
- `src/app/api/exports/powerbi-feed/route.ts` — feed JSON tabular.

## Smoke test

```bash
curl http://localhost:3000/api/templates/powerbi
# 200, lista 4 templates

curl http://localhost:3000/api/templates/powerbi/cost-overview?format=pq
# 200, application/text con el script .pq

curl http://localhost:3000/api/exports/powerbi-feed?type=costs
# 401 sin auth

curl -H "Authorization: Bearer mcp_xxx" \
  "http://localhost:3000/api/exports/powerbi-feed?type=costs&days=30"
# 200, {success:true, type:"costs", days:30, data:[{date,costUSD},...]}
```

## Próximas mejoras (no incluidas)
- UI para descubrir/descargar templates desde `/admin/reports/powerbi`.
- Generar `.pbit` real con DataMashup vía paquete `node-stream-zip` + XML templating (alto esfuerzo).
- Más templates: Commitments coverage, Tag compliance, Anomalies.
- OData v4 feed real (mejor experiencia Power BI vs JSON crudo): `$top`, `$filter`, `$select`.
- Personalización por tenant: branding/colores hardcoded en el script M.
