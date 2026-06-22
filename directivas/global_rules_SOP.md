# Directivas Globales del Proyecto

## Restricciones y Patrones Estrictos

### 1. Nunca usar código hardcodeado (Hardcoded Data)
**Regla:** Queda terminantemente prohibido utilizar datos de prueba, *mock data* o valores estáticos *hardcodeados* en los componentes del Frontend o en la lógica del Backend que se ponga en producción, independientemente de si se solicita un "prototipo rápido" o la directiva de "Token Optimization Mode".
- **Por qué falló antes:** En el módulo de *Green FinOps (Sustainability)* se inyectaron valores estáticos (`730 * 10`) para simular consumo, lo que provocó que la interfaz no reaccionara a los cambios de Tenant o Suscripción, causando frustración en el usuario.
- **En su lugar hacer:** Toda métrica, por más preliminar que sea el módulo, DEBE estar respaldada por un endpoint de API que lea datos dinámicos (vía Azure Resource Graph, Cost Management o Bases de Datos), aunque la fórmula de cálculo sea básica o una estimación inicial.

### 2. Protocolo Estricto de Migración de Base de Datos
**Regla:** Todos los agentes (Frontend, Backend, DBA) que modifiquen esquemas de base de datos deben seguir rigurosamente el protocolo "STRICT DATABASE MIGRATION PROTOCOL".
- **Referencia:** Ver `directivas/agent_dba_SOP.md` para los detalles.
- **Acción Obligatoria:** Siempre se debe incluir el script `--- PRODUCTION DB MIGRATION SCRIPT ---` al final de la respuesta si se modifican estructuras (tablas, columnas, índices, restricciones). Las migraciones locales deben ser siempre seguras (`ALTER TABLE` con `try/catch`).
