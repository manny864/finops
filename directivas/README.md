# Directivas / SOPs

Standard Operating Procedures (SOPs) histórico-vinculantes que documentan decisiones de arquitectura, patrones de implementación, gotchas conocidos, y protocolos del proyecto.

## Por qué existe esta carpeta

Cada SOP captura el **contexto** y la **lógica** detrás de una feature, módulo o decisión. Sirve como:

- **Memoria institucional** del proyecto.
- **Onboarding** para nuevos agentes/desarrolladores.
- **Referencia** para evitar repetir errores ya resueltos.

## Convenciones

- Nombre: `<feature>_SOP.md` en `snake_case`.
- Estructura recomendada:
  - Objetivo
  - Entradas
  - Lógica y Pasos
  - Trampas Conocidas / Restricciones
- Mantener actualizado cuando la feature cambie sustancialmente.

## SOPs clave

| SOP | Resumen |
|---|---|
| `global_rules_SOP.md` | Reglas globales del proyecto (hardcoded data prohibido, migration protocol, docs post-fix) |
| `agent_dba_SOP.md` | Protocolo estricto de migraciones de DB |
| `security_db_SOP.md` | JWT isolation + Azure Key Vault integration |
| `tag_compliance_SOP.md` | Tag Compliance Engine (recursos + RGs) |
| `rbac_onboarding_SOP.md` | Asignación RBAC en onboarding multi-tenant |
| `i18n_setup_SOP.md` | Setup next-intl (en/es/pt-BR) |
| `mock_data_SOP.md` | Convenciones para mocks por tier |

## Relación con AGENTS.md

`AGENTS.md` contiene las **14 directivas operativas vinculantes** de alto nivel.
Esta carpeta contiene los **SOPs específicos por feature/módulo** que detallan implementación y contexto técnico.

**No borrar SOPs sin revisión** — incluso los aparentemente obsoletos pueden tener gotchas relevantes para refactors futuros.
