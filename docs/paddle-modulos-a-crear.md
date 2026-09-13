# Módulos del marketplace — productos en Paddle

**Estado: los 114 productos existen y sus price IDs están en `paddle-modulos-a-crear.env`.**

El precio real lo define Paddle; estos montos viven en `basePriceUSD` del catálogo
sólo como fallback determinista para CI y para cuando Paddle no responde.
Curva de descuento única: 12 / 19 / 25 / 29 %.

| Módulo | Ruta | Tier que lo incluye | mensual | 1m | 3m | 6m | 9m | 12m |
|---|---|---|---|---|---|---|---|---|
| Bases de Datos | `/intelligence/bases-de-datos` | Business | 129 | 129 | 341 | 627 | 871 | 1099 |
| Cómputo | `/intelligence/computo` | Business | 129 | 129 | 341 | 627 | 871 | 1099 |
| Credenciales Expiradas | `/governance/credentials` | Business | 79 | 79 | 209 | 384 | 533 | 673 |
| Inventario de Recursos | `/overview/resources` | Business | 79 | 79 | 209 | 384 | 533 | 673 |
| Redes | `/intelligence/redes` | Business | 79 | 79 | 209 | 384 | 533 | 673 |
| Alta Disponibilidad | `/governance/ha` | Business | 59 | 59 | 159 | 287 | 399 | 499 |
| Power Schedules | `/governance/power` | Business | 59 | 59 | 159 | 287 | 399 | 499 |
| TTL Expiration | `/cleanup/ttl` | Business | 59 | 59 | 159 | 287 | 399 | 499 |
| Aprobaciones | `/governance/approvals` | Business | 39 | 39 | 103 | 189 | 263 | 329 |
| Almacenamiento | `/intelligence/almacenamiento` | Enterprise | 129 | 129 | 341 | 627 | 871 | 1099 |
| Analítica Avanzada | `/intelligence/analitica-avanzada` | Enterprise | 129 | 129 | 341 | 627 | 871 | 1099 |
| Azure AI | `/intelligence/azure-ai` | Enterprise | 129 | 129 | 341 | 627 | 871 | 1099 |
| Azure Integration Services | `/intelligence/integration-services` | Enterprise | 129 | 129 | 341 | 627 | 871 | 1099 |
| Governance Reporting | `/governance/reporting` | Enterprise | 129 | 129 | 341 | 627 | 871 | 1099 |
| Monitoreo | `/intelligence/monitoreo` | Enterprise | 129 | 129 | 341 | 627 | 871 | 1099 |
| Optimización y Ahorro | `/intelligence/optimizacion-y-ahorro` | Enterprise | 129 | 129 | 341 | 627 | 871 | 1099 |
| Policies y Autoblock | `/governance/policies` | Enterprise | 129 | 129 | 341 | 627 | 871 | 1099 |
| Seguridad | `/intelligence/seguridad` | Enterprise | 129 | 129 | 341 | 627 | 871 | 1099 |
| Usuarios y Licencias | `/intelligence/licenses` | Enterprise | 129 | 129 | 341 | 627 | 871 | 1099 |

## Variables de entorno

Ver `paddle-modulos-a-crear.env`. Convención `PADDLE_PRICE_<MODULO>_<DURACION>`,
con `YEARLY` cubriendo además `pass12m`, igual que los cinco add-ons originales.

| Duración | Tipo de precio en Paddle |
|---|---|
| MONTHLY | recurrente mensual |
| 1M | pago único |
| 3M | pago único |
| 6M | pago único |
| 9M | pago único |
| YEARLY | recurrente anual |
