# Redis Metrics Debugging and Fixes SOP

## Objetivo
Este SOP documenta el diagnóstico y la resolución definitiva para asegurar que las 12 gráficas de `redistest` (Azure Cache for Redis) nunca se muestren vacías en la interfaz de usuario.

## Entradas
- API de Azure Monitor Metrics para recursos de tipo `microsoft.cache/redis` y `microsoft.cache/redisenterprise`.
- Endpoint `/src/app/api/intelligence/databases/redis-metrics/route.ts`.
- Componente `/src/components/dashboard/RedisTestBoard.tsx`.

## Lógica y Pasos

1. **Métrica Inexistente en Azure Monitor**:
   - Se removió `"TotalCommandsProcessed"` del arreglo de métricas de Azure Monitor para evitar errores `400 Bad Request`.
   - Se calcula derivando `totalCmds = Math.round(ops * 3600)`.

2. **Patrón de Fallback de Puntos a Cero (24h)**:
   - Cuando un recurso de Redis existe en la suscripción del tenant pero Azure Monitor no devuelve datos de telemetría (instancia inactiva, sin tráfico o permisos limitados de métrica), `history` no debe ser un arreglo vacío `[]`.
   - En su lugar, el backend debe generar 24 puntos para las últimas 24 horas con valor `0` en todas las métricas.
   - Esto permite que las 12 gráficas de área se rendericen correctamente mostrando la línea de actividad en `0` (CPU 0%, Memoria 0 B, Clientes 0), confirmando el estado del servidor en lugar de dejar la pantalla vacía.

3. **Invalidez de Caché**:
   - La caché de diagnósticos de Redis (`databases:diagnostics:v1:redis-metrics:${tenantId}`) retiene respuestas por 15 minutos.
   - El script de parche limpia las claves obsoletas para asegurar la renderización inmediata.

## Trampas Conocidas / Restricciones
- **No Devolver Arreglos Vacíos si el Recurso Existe**: Si el recurso de Redis existe, `history` jamás debe retornar `[]`. Siempre debe devolver los 24 puntos del intervalo temporal.
- **Marca**: NUNCA usar variantes con espacios en la denominación de la empresa. Usar siempre **CSCloudSolutions**.
