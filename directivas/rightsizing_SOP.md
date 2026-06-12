# Rightsizing Engine SOP

- **Azure Monitor API**: Se consulta `Percentage CPU` utilizando la sintaxis de ISO 8601 Duration (`P14D` para timespan, `P1D` para intervalo).
- **Lógica de Decisión**: Máquinas con Pico CPU (Maximum) inferior a 20% en un periodo de 14 días se marcan como subutilizadas.
- **Concurrencia**: Al leer métricas de múltiples VMs, se envuelve en `Promise.all` para evitar tiempos de espera prolongados en el backend.
- **Error Handling**: Las consultas fallidas de Resource Graph (generalmente errores genéricos con correlationId) se capturan y renderizan como alertas de permisos de Azure RBAC en la UI.
- **Rate Limiting (429) de Azure Resource Graph**:
  - *Nota*: No lanzar múltiples consultas concurrentes a `argClient.resources` con `Promise.all` en el backend sin reintentos o delays, porque causa errores `429 RateLimiting (Internal Server Error)`.
  - *En su lugar*: Implementar un helper de reintento (`queryResourceGraphWithRetry`) con retroceso exponencial (exponential backoff) para peticiones ARG, y realizar las consultas de manera secuencial o con pequeños retrasos (delays) de 1000ms.