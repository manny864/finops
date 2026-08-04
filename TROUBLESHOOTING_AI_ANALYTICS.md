# Troubleshooting AI Cost Analytics - Microsoft Foundry

## Problema reportado
Microsoft Foundry AI Cost Analytics no muestra datos, aunque los modelos (gpt-5.1, gpt-5.3-codex) tienen consumo real registrado en Foundry playground.

## Raíz del problema identificada

### 1. SQL Error en Producción (SOLUCIONADO)
**Error**: `Expression #2 of SELECT list is not in GROUP BY clause`
- **Causa**: Query fallback en CostSnapshots tenía columnas no agregadas fuera del GROUP BY
- **Impacto**: La respuesta del endpoint devolvía cero datos silenciosamente
- **Fix**: Agregadas todas las columnas no agregadas al GROUP BY clause
- **Commit**: `5035ad0`
- **Deployment**: 2026-08-04T21:57 UTC ✅

### 2. Incertidumbre sobre Foundry
**Pregunta**: ¿Los modelos Foundry gpt-5.1/gpt-5.3-codex emiten métricas a Azure Monitor Metrics?
- **Acción anterior**: Ampliada búsqueda KQL a tipos `microsoft.ai.*`
- **Estado**: Desconocido — requiere diagnosticación en tenant real

## Cómo diagnosticar ahora

### Paso 1: Ejecutar endpoint de diagnóstico
```bash
curl -H "Authorization: Bearer <JWT_DEL_TENANT>" \
  "https://cscs-finops.azurewebsites.net/api/intelligence/ai-analytics/diagnostics?tenantId=<TENANT_ID>&pageSize=15"
```

**Este endpoint retorna:**
- Filas en `AICostSnapshots` (tabla primaria AI tokens)
- Subscriptions visibles (truncadas por tier)
- Recursos IA descubiertos (tipo + cantidad)
- Definiciones de métricas disponibles por recurso
- Probe de cada métrica (series + suma total)
- Filas producidas por el colector
- **Conclusión diagnóstica** con recomendaciones

### Paso 2: Interpretar la conclusión

| Conclusión | Significado | Acción |
|---|---|---|
| "El colector produce filas. Ejecute el cron..." | Datos llegan a DB pero cache está stale | Ejecutar POST `/api/cron/sync` manualmente |
| "Las cuentas AI NO exponen las métricas..." | Foundry no emite a Monitor (sospecha alta) | Revisar si Foundry usa otra API de cost |
| "Las métricas existen pero devuelven 0..." | Consumo aún no llegó a Monitor (~15 min latencia) | Reintentear en 10-15 min |
| "No se encontraron recursos IA" | KQL no descubrió nada con tipos actuales | Revisar si Foundry usa tipo resource distinto |
| "Acceso negado a subscriptions" | RBAC insuficiente | Agregar rol Monitoring Reader al SP |

### Paso 3: Ejecutar cron manualmente (si es necesario)
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://cscs-finops.azurewebsites.net/api/cron/sync?force=1"
```

Espera ~30 segundos. Luego recarga `/intelligence/ai-analytics` en la UI.

## Cambios deployados (2026-08-04)

| Commit | Descripción | Deploy |
|---|---|---|
| `90a1f62` | Request métricas de token una por una (fix Azure Monitor batch reject) | ✅ |
| `82eaae5` | Endpoint `/api/intelligence/ai-analytics/diagnostics` | ✅ |
| `c75f807` | Documentación + diagnostics | ✅ |
| `4d40392` | PDFs | ✅ |
| `976508c` | Ampliar KQL a `microsoft.ai.*` | ✅ |
| `ab725cc` | Diagnostics use mismo KQL | ✅ |
| `5035ad0` | **SQL GROUP BY fix** | ✅ |

## Próximos pasos

1. **Usuario ejecuta diagnostics endpoint** → obtiene conclusión específica
2. **Si "no data"** → revisar Azure / revisar KQL / contactar Foundry support
3. **Si "collector produce filas"** → problema es cache/tier/cron — más simple de resolver
4. **Si "métricas existen pero 0"** → esperar ~15 min más (latencia Monitor)

## Contacto para escalación

Si después de estos pasos aún no ves datos:
1. Copia el output completo del diagnostics endpoint
2. Revisa los logs de Azure Container App: `az containerapp logs show ...`
3. Verifica que el SP tiene rol `Monitoring Reader` en las subscriptions Foundry

---

**Nota**: Este documento acompaña la directiva #3 (Documentación sincronizada). Revisar después de cada cambio al flujo de AI Analytics.
